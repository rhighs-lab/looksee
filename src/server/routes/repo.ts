import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from '@/server/context.js';
import { buildFileDiffs, scopeRevs } from '@/server/diff-service.js';
import { attributeLayers } from '@/server/git/attribute.js';
import {
  blobExists,
  getBlobLines,
  getBlobText,
  getRepoFiles,
  isBinaryText,
  splitLines,
} from '@/server/git/blobs.js';
import { parseComparison } from '@/server/git/comparison.js';
import { inferLanguage } from '@/server/git/diff-parser.js';
import { isSafeRef } from '@/server/git/exec.js';
import { safeRelPath } from '@/server/git/paths.js';
import { listBranches } from '@/server/git/refs.js';
import { readStatus } from '@/server/git/state.js';
import { packageRoot } from '@/server/pkg-root.js';
import { highlightLines } from '@/server/render/highlighter.js';
import {
  endSession,
  getSession,
  repin,
  setScope,
} from '@/server/review/session.js';
import { sampleDiffs } from '@/server/sample.js';
import type { RepoWatcher, Selection } from '@/server/watch/watcher.js';
import type {
  BranchesResponse,
  Comparison,
  ContextResponse,
  DiffResponse,
  FileViewResponse,
  HealthResponse,
  RefSelection,
  Rev,
  Scope,
  ScopePreset,
  ServerEvent,
  TreeEntry,
} from '@/shared/protocol.js';
import {
  MAX_HIGHLIGHT_LINES,
  SCOPE_PRESETS,
  SCOPES,
} from '@/shared/protocol.js';

const PKG_VERSION = (
  JSON.parse(
    fs.readFileSync(
      path.join(packageRoot(import.meta.url), 'package.json'),
      'utf8'
    )
  ) as { version: string }
).version;

const parseScope = (raw: string | undefined): Scope =>
  SCOPES.includes(raw as Scope) ? (raw as Scope) : 'cumulative';

function parseRev(raw: string | undefined): Rev | null {
  if (!raw || raw === 'WORKTREE' || raw === 'INDEX') return raw || 'WORKTREE';
  return isSafeRef(raw) ? raw : null;
}

const isPreset = (v: unknown): v is ScopePreset =>
  SCOPE_PRESETS.includes(v as ScopePreset);

const jsonBody = async (c: {
  req: { json(): Promise<unknown> };
}): Promise<Record<string, unknown>> => {
  try {
    return ((await c.req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export function repoRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => {
    const body: HealthResponse = {
      ok: true,
      app: 'looksee',
      repoRoot: ctx.repoRoot,
      version: ctx.state().version,
      pkgVersion: PKG_VERSION,
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

  const scoped = async (
    w: RepoWatcher,
    sel: Selection
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const prev: Selection = { ...w.selection(), ...w.scope() };
    try {
      await w.select(sel);
    } catch (err) {
      await w.select(prev);
      return { ok: false, error: (err as Error).message };
    }
    const err = ctx.state().error;
    if (!err) return { ok: true };
    await w.select(prev);
    return { ok: false, error: err };
  };

  const applyScope = async (
    w: RepoWatcher,
    repoRoot: string,
    preset: ScopePreset,
    custom: Comparison | null
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const prev = await getSession(repoRoot);
    const res = await scoped(w, {
      preset,
      custom,
      ...(preset === 'custom' ? {} : { head: null }),
    });
    if (res.ok) await setScope(repoRoot, preset, custom ?? undefined);
    else if (prev)
      await setScope(repoRoot, prev.scope, prev.custom ?? undefined);
    return res;
  };

  app.post('/api/refs', async (c) => {
    if (!ctx.repoRoot || !ctx.watcher) return c.json({ error: 'no repo' }, 400);
    const body = await jsonBody(c);
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
    const picked = await scoped(ctx.watcher, {
      ...(base !== undefined ? { base } : {}),
      ...(head !== undefined ? { head } : {}),
    });
    if (!picked.ok) return c.json({ error: picked.error }, 400);
    const refs = ctx.state().refs!;
    const tip = refs.head.checkedOut
      ? 'HEAD'
      : (refs.head.branch ?? refs.head.sha);
    const custom: Comparison = {
      baseline: { kind: 'merge-base', left: refs.base.ref, right: tip },
      endpoint: refs.head.checkedOut
        ? { kind: 'worktree' }
        : { kind: 'ref', name: tip },
    };
    const res = await applyScope(ctx.watcher, ctx.repoRoot, 'custom', custom);
    if (!res.ok) return c.json({ error: res.error }, 400);
    return c.json(ctx.state());
  });

  app.get('/api/session', async (c) =>
    c.json(ctx.repoRoot ? await getSession(ctx.repoRoot) : null)
  );

  app.post('/api/session/pin', async (c) => {
    if (!ctx.repoRoot || !ctx.watcher) return c.json({ error: 'no repo' }, 400);
    await repin(ctx.repoRoot);
    await ctx.watcher.refresh();
    return c.json(ctx.state());
  });

  app.post('/api/session/end', async (c) => {
    if (!ctx.repoRoot || !ctx.watcher) return c.json({ error: 'no repo' }, 400);
    await endSession(ctx.repoRoot);
    await ctx.watcher.refresh();
    return c.json(ctx.state());
  });

  app.post('/api/scope', async (c) => {
    if (!ctx.repoRoot || !ctx.watcher) return c.json({ error: 'no repo' }, 400);
    const body = await jsonBody(c);
    const preset = body['preset'];
    if (!isPreset(preset)) return c.json({ error: 'invalid preset' }, 400);
    const custom =
      body['custom'] === undefined ? null : parseComparison(body['custom']);
    if (body['custom'] !== undefined && !custom)
      return c.json({ error: 'invalid comparison' }, 400);
    if (preset === 'custom' && !custom && !ctx.watcher.scope().custom)
      return c.json({ error: 'custom comparison required' }, 400);
    const res = await applyScope(
      ctx.watcher,
      ctx.repoRoot,
      preset,
      custom ?? ctx.watcher.scope().custom
    );
    if (!res.ok) return c.json({ error: res.error }, 400);
    return c.json(ctx.state());
  });

  app.get('/api/diff', async (c) => {
    const scope = parseScope(c.req.query('scope'));
    const paths =
      c.req
        .queries('path')
        ?.map(safeRelPath)
        .filter((p): p is string => Boolean(p)) ?? [];
    const full = c.req.query('full') === '1';
    const attribute = c.req.query('attribute') === '1';
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
      const files = await buildFileDiffs(
        ctx.repoRoot,
        scope,
        {
          refs: state.refs,
          comparison: state.comparison,
          statusDigest: ctx.statusDigest(),
        },
        { paths, full }
      );
      if (attribute)
        await attributeLayers(
          ctx.repoRoot,
          state.refs,
          files,
          state.refs.head.checkedOut ? await readStatus(ctx.repoRoot) : []
        );
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
    const diffCtx = {
      refs: state.refs,
      comparison: state.comparison,
      statusDigest: ctx.statusDigest(),
    };
    const { rev: scopeRev, oldRev } = scopeRevs(scope, diffCtx);
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
      const [diff] = await buildFileDiffs(ctx.repoRoot, scope, diffCtx, {
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
