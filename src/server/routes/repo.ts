import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from '@/server/context.js';
import { buildFileDiffs, scopeRevs } from '@/server/diff-service.js';
import {
  blobExists,
  getBlobLines,
  getBlobText,
  getRepoFiles,
  isBinaryText,
  splitLines,
} from '@/server/git/blobs.js';
import { inferLanguage } from '@/server/git/diff-parser.js';
import { isSafeRef } from '@/server/git/exec.js';
import { safeRelPath } from '@/server/git/paths.js';
import { listBranches } from '@/server/git/refs.js';
import { highlightLines } from '@/server/render/highlighter.js';
import { sampleDiffs } from '@/server/sample.js';
import type {
  BranchesResponse,
  ContextResponse,
  DiffResponse,
  FileViewResponse,
  HealthResponse,
  RefSelection,
  Rev,
  Scope,
  ServerEvent,
  TreeEntry,
} from '@/shared/protocol.js';
import { MAX_HIGHLIGHT_LINES, SCOPES } from '@/shared/protocol.js';

const parseScope = (raw: string | undefined): Scope =>
  SCOPES.includes(raw as Scope) ? (raw as Scope) : 'cumulative';

function parseRev(raw: string | undefined): Rev | null {
  if (!raw || raw === 'WORKTREE' || raw === 'INDEX') return raw || 'WORKTREE';
  return isSafeRef(raw) ? raw : null;
}

export function repoRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => {
    const body: HealthResponse = {
      ok: true,
      app: 'looksee',
      repoRoot: ctx.repoRoot,
      version: ctx.state().version,
    };
    return c.json(body);
  });

  app.get('/api/state', (c) => c.json(ctx.state()));

  app.get('/api/branches', async (c) => {
    if (!ctx.repoRoot)
      return c.json<BranchesResponse>({ current: null, local: [], remote: [] });
    const { local, remote } = await listBranches(ctx.repoRoot);
    return c.json<BranchesResponse>({
      current: ctx.state().refs?.head.checkedOut
        ? (ctx.state().refs?.head.branch ?? null)
        : null,
      local,
      remote,
    });
  });

  app.get('/api/refs', (c) =>
    c.json<RefSelection>(ctx.watcher?.selection() ?? { base: null, head: null })
  );

  app.post('/api/refs', async (c) => {
    if (!ctx.repoRoot || !ctx.watcher) return c.json({ error: 'no repo' }, 400);
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      /* empty body */
    }
    const pick = (v: unknown): string | null | undefined =>
      v === undefined
        ? undefined
        : v === null || v === ''
          ? null
          : isSafeRef(v)
            ? v
            : undefined;
    const base = pick(body['base']);
    const head = pick(body['head']);
    if (
      (body['base'] !== undefined && base === undefined) ||
      (body['head'] !== undefined && head === undefined)
    )
      return c.json({ error: 'invalid ref' }, 400);
    const prev = ctx.watcher.selection();
    try {
      await ctx.watcher.select({
        ...(base !== undefined ? { base } : {}),
        ...(head !== undefined ? { head } : {}),
      });
    } catch (err) {
      await ctx.watcher.select(prev);
      return c.json({ error: (err as Error).message }, 400);
    }
    const state = ctx.state();
    if (state.error) {
      await ctx.watcher.select(prev);
      return c.json({ error: state.error }, 400);
    }
    return c.json(state);
  });

  app.get('/api/diff', async (c) => {
    const scope = parseScope(c.req.query('scope'));
    const paths =
      c.req
        .queries('path')
        ?.map(safeRelPath)
        .filter((p): p is string => Boolean(p)) ?? [];
    const full = c.req.query('full') === '1';
    const state = ctx.state();
    if (!ctx.repoRoot) {
      const files = sampleDiffs().filter(
        (f) => !paths.length || paths.includes(f.path)
      );
      return c.json<DiffResponse>({
        scope: 'cumulative',
        version: state.version,
        files,
      });
    }
    if (!state.refs)
      return c.json(
        { error: state.error ?? 'repository state unavailable' },
        503
      );
    try {
      const files = await buildFileDiffs(ctx.repoRoot, scope, state.refs, {
        paths,
        full,
      });
      return c.json<DiffResponse>({ scope, version: state.version, files });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/context', async (c) => {
    if (!ctx.repoRoot) return c.json({ error: 'no repo' }, 400);
    const filePath = safeRelPath(c.req.query('path'));
    const rev = parseRev(c.req.query('rev'));
    const start = parseInt(c.req.query('start') ?? '', 10);
    const end = parseInt(c.req.query('end') ?? '', 10);
    if (
      !filePath ||
      !rev ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start
    )
      return c.json({ error: 'bad params' }, 400);
    if (end - start > 20_000) return c.json({ error: 'range too large' }, 400);
    try {
      const { lines, from, eof } = await getBlobLines(
        ctx.repoRoot,
        rev,
        filePath,
        start,
        end
      );
      const plain = lines.length > MAX_HIGHLIGHT_LINES;
      const html = plain
        ? null
        : await highlightLines(lines, inferLanguage(filePath));
      return c.json<ContextResponse>({
        from,
        eof,
        lines,
        html,
        plain,
        maxHighlight: MAX_HIGHLIGHT_LINES,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/file', async (c) => {
    if (!ctx.repoRoot) return c.json({ error: 'no repo' }, 400);
    const filePath = safeRelPath(c.req.query('path'));
    if (!filePath) return c.json({ error: 'not found' }, 404);
    const scope = parseScope(c.req.query('scope'));
    const state = ctx.state();
    if (!state.refs)
      return c.json(
        { error: state.error ?? 'repository state unavailable' },
        503
      );
    const entry =
      state.files.find((f) => f.path === filePath || f.oldPath === filePath) ??
      null;
    const deleted = entry?.kind === 'deleted';
    const { rev: scopeRev, oldRev } = scopeRevs(scope, state.refs);
    const rev: Rev = deleted ? oldRev : scopeRev;
    const text = await getBlobText(ctx.repoRoot, rev, filePath);
    if (text === '' && !(await blobExists(ctx.repoRoot, rev, filePath)))
      return c.json({ error: 'not found' }, 404);
    const binary = Boolean(entry?.binary) || isBinaryText(text);
    const lines = binary ? [] : splitLines(text);
    const plain = lines.length > MAX_HIGHLIGHT_LINES;
    const html =
      plain || binary
        ? null
        : await highlightLines(lines, inferLanguage(filePath));
    let changedLines: number[] = [];
    if (entry && !deleted && !binary) {
      const [diff] = await buildFileDiffs(ctx.repoRoot, scope, state.refs, {
        paths: [filePath],
        full: true,
      }).catch(() => []);
      changedLines = diff
        ? diff.hunks.flatMap((h) =>
            h.lines.filter((l) => l.type === 'add').map((l) => l.newNumber!)
          )
        : [];
    }
    const kinds = new Map(state.files.map((f) => [f.path, f.kind]));
    const paths = new Set(await getRepoFiles(ctx.repoRoot, scopeRev));
    for (const f of state.files) paths.add(f.path);
    const tree: TreeEntry[] = [...paths]
      .sort()
      .map((p) => ({ path: p, kind: kinds.get(p) ?? 'unchanged' }));
    return c.json<FileViewResponse>({
      path: filePath,
      rev,
      lines,
      html,
      binary,
      deleted,
      inDiff: Boolean(entry) && !deleted && !binary,
      changedLines,
      plain,
      maxHighlight: MAX_HIGHLIGHT_LINES,
      tree,
    });
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const send = (ev: ServerEvent) =>
        stream.writeSSE({ data: JSON.stringify(ev) });
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'hello',
          version: ctx.state().version,
        } satisfies ServerEvent),
        retry: 2000,
      });
      const unsubscribe = ctx.hub.subscribe(
        (ev) => void send(ev).catch(() => {})
      );
      const ping = setInterval(
        () => void stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}),
        25_000
      );
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
      };
      stream.onAbort(close);
      await new Promise<void>((resolve) => {
        const check = () =>
          closed || stream.aborted ? resolve() : setTimeout(check, 1000);
        check();
      });
      close();
    })
  );

  return app;
}
