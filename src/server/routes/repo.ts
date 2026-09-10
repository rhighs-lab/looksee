import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from '@/server/context.js';
import {
  buildCommitDiffs,
  buildFileDiffs,
  scopeRevs,
} from '@/server/diff-service.js';
import { attributeLayers } from '@/server/git/attribute.js';
import {
  blobExists,
  getBlobBytes,
  getBlobLines,
  getBlobText,
  getRepoFiles,
  isBinaryText,
  splitLines,
} from '@/server/git/blobs.js';
import { parseComparison } from '@/server/git/comparison.js';
import { inferLanguage } from '@/server/git/diff-parser.js';
import { git, isSafeRef } from '@/server/git/exec.js';
import { safeRelPath } from '@/server/git/paths.js';
import { listBranches } from '@/server/git/refs.js';
import { readStatus } from '@/server/git/state.js';
import { packageRoot } from '@/server/pkg-root.js';
import {
  highlightLines,
  highlightStylesVersion,
} from '@/server/render/highlighter.js';
import { resolveAvatars } from '@/server/review/gh-avatars.js';
import { isMarkdownPath, renderDoc } from '@/server/review/markdown.js';
import {
  endSession,
  getSession,
  repin,
  setScope,
} from '@/server/review/session.js';
import {
  appearance,
  readUiPrefs,
  theme,
  writeUiPrefs,
} from '@/server/review/ui-prefs.js';
import { sampleDiffs } from '@/server/sample.js';
import type { RepoWatcher, Selection } from '@/server/watch/watcher.js';
import { imageTypeOf } from '@/shared/media.js';
import type {
  BranchesResponse,
  CommitContributor,
  CommitDetailResponse,
  CommitsResponse,
  Comparison,
  ContextResponse,
  DiffResponse,
  FileHistoryEntry,
  FileHistoryInfo,
  FileHistoryResponse,
  FileInfoResponse,
  FileStatInfo,
  FileViewResponse,
  HealthResponse,
  RefSelection,
  Rev,
  Scope,
  ScopePreset,
  ServerEvent,
  TreeAtCommitResponse,
  TreeEntry,
} from '@/shared/protocol.js';
import {
  MAX_HIGHLIGHT_LINES,
  SCOPE_PRESETS,
  SCOPES,
} from '@/shared/protocol.js';
import { extractSymbols } from '../code/symbols.js';

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

const GH_NOREPLY = /^(?:\d+\+)?([\w-]+)@users\.noreply\.github\.com$/i;
const CO_AUTHOR = /^\s*co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim;

const loginOf = (email: string): string | null =>
  GH_NOREPLY.exec(email)?.[1] ?? null;

const isBot = (email: string): boolean =>
  /^no-?reply@/i.test(email) && !/@users\.noreply\.github\.com$/i.test(email);

export function contributorsOf(
  author: string,
  email: string,
  body: string
): CommitContributor[] {
  const out: CommitContributor[] = [
    {
      name: author,
      email,
      login: loginOf(email),
      avatarUrl: null,
      bot: isBot(email),
      role: 'author',
    },
  ];
  const seen = new Set([email.toLowerCase()]);
  for (const m of body.matchAll(CO_AUTHOR)) {
    const co = m[2]!.toLowerCase();
    if (seen.has(co)) continue;
    seen.add(co);
    out.push({
      name: m[1]!,
      email: m[2]!,
      login: loginOf(m[2]!),
      avatarUrl: null,
      bot: isBot(m[2]!),
      role: 'co-author',
    });
  }
  return out;
}

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

  app.get('/api/ui-prefs', async (c) => c.json(await readUiPrefs()));

  app.post('/api/ui-prefs', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json(
      await writeUiPrefs({
        theme: theme(b['theme']),
        appearance: appearance(b['appearance']),
      })
    );
  });

  app.post('/api/open-editor', async (c) => {
    if (!ctx.repoRoot) return c.json({ error: 'no repository' }, 400);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rel = safeRelPath(String(b['path'] ?? ''));
    if (!rel) return c.json({ error: 'bad path' }, 400);
    const n = Number(b['line']);
    const target = path.join(ctx.repoRoot, rel);
    const at = Number.isInteger(n) && n > 0 ? `${target}:${n}` : target;
    const child = spawn('code', ['-r', ctx.repoRoot, '-g', at], {
      detached: true,
      stdio: 'ignore',
    });
    const failed = await new Promise<string | null>((resolve) => {
      child.once('error', (e) => resolve(e.message));
      child.once('spawn', () => resolve(null));
    });
    if (failed) return c.json({ error: failed }, 500);
    child.unref();
    return c.json({ ok: true });
  });

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

  app.post('/api/title', async (c) => {
    if (!ctx.repoRoot || !ctx.watcher) return c.json({ error: 'no repo' }, 400);
    const body = await jsonBody(c);
    const raw = body['title'];
    if (raw !== null && typeof raw !== 'string')
      return c.json({ error: 'invalid title' }, 400);
    await ctx.watcher.select({ title: raw ? raw : null });
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
        : await highlightLines(lines, inferLanguage(filePath), 'classed');
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
        : await highlightLines(lines, inferLanguage(filePath), 'classed');
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
      symbols: binary
        ? { status: 'unsupported', symbols: [] }
        : await extractSymbols(filePath, text),
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
      markdownHtml:
        !binary && !deleted && isMarkdownPath(filePath)
          ? await renderDoc(lines.join('\n'), filePath).catch(() => null)
          : null,
      tree,
    });
  });

  app.get('/api/commits', async (c) => {
    const root = ctx.repoRoot;
    const cmp = ctx.state().comparison;
    if (!root || !cmp) return c.json<CommitsResponse>({ commits: [] });
    const from = cmp.baseline.oid;
    const to = cmp.endpoint.kind === 'worktree' ? 'HEAD' : cmp.endpoint.oid;
    if (!from || !to) return c.json<CommitsResponse>({ commits: [] });
    const SEP = '\u001f';
    const REC = '\u001e';
    const out = await git(root, [
      'log',
      `${from}..${to}`,
      '--name-only',
      '--no-merges',
      `--format=${REC}%H${SEP}%an${SEP}%aI${SEP}%s`,
    ]).catch(() => '');
    const commits = out
      .split(REC)
      .filter((chunk) => chunk.trim())
      .map((chunk) => {
        const [head = '', ...rest] = chunk.split('\n');
        const [sha = '', author = '', date = '', subject = ''] =
          head.split(SEP);
        return {
          sha,
          short: sha.slice(0, 7),
          author,
          date,
          subject,
          files: rest.map((l) => l.trim()).filter(Boolean),
        };
      })
      .filter((x) => x.sha);
    return c.json<CommitsResponse>({ commits });
  });

  app.get('/api/commit/:sha', async (c) => {
    if (!ctx.repoRoot) return c.json({ error: 'no repo' }, 400);
    const sha = c.req.param('sha');
    if (!isSafeRef(sha)) return c.json({ error: 'invalid sha' }, 400);
    const SEP = '\u001f';
    const meta = await git(ctx.repoRoot, [
      'show',
      '--no-patch',
      `--format=%H${SEP}%an${SEP}%aI${SEP}%s${SEP}%ae${SEP}%b`,
      sha,
    ]).catch(() => '');
    const [
      full = '',
      author = '',
      date = '',
      subject = '',
      email = '',
      body = '',
    ] = meta.trim().split(SEP);
    if (!full) return c.json({ error: 'not found' }, 404);
    const [prev, next] = await Promise.all([
      git(ctx.repoRoot, ['rev-parse', '--verify', `${full}^`])
        .then((o) => o.trim() || null)
        .catch(() => null),
      git(ctx.repoRoot, [
        'rev-list',
        '--first-parent',
        '--reverse',
        `${full}..HEAD`,
      ])
        .then((o) => o.trim().split('\n')[0] || null)
        .catch(() => null),
    ]);
    try {
      const files = await buildCommitDiffs(
        ctx.repoRoot,
        full,
        c.req.query('full') === '1'
      );
      return c.json<CommitDetailResponse>({
        commit: {
          sha: full,
          short: full.slice(0, 7),
          author,
          date,
          subject,
          files: files.map((f) => f.path),
        },
        body: body.trim(),
        prev,
        next,
        contributors: await resolveAvatars(
          ctx.state().refs?.remoteUrl ?? null,
          full,
          contributorsOf(author, email, body)
        ),
        files,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/tree/:sha', async (c) => {
    if (!ctx.repoRoot) return c.json({ error: 'no repo' }, 400);
    const sha = c.req.param('sha');
    if (!isSafeRef(sha)) return c.json({ error: 'invalid sha' }, 400);
    try {
      const paths = await getRepoFiles(ctx.repoRoot, sha);
      return c.json<TreeAtCommitResponse>({
        sha,
        short: sha.slice(0, 7),
        paths,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.get('/api/file-history', async (c) => {
    if (!ctx.repoRoot) return c.json({ error: 'no repo' }, 400);
    const filePath = safeRelPath(c.req.query('path'));
    if (!filePath) return c.json({ error: 'bad path' }, 400);
    const SEP = '\u001f';
    const out = await git(ctx.repoRoot, [
      'log',
      '--follow',
      '--no-merges',
      '-n',
      '50',
      `--format=%H${SEP}%s${SEP}%aI${SEP}%an${SEP}%ae${SEP}%b${SEP}%x1e`,
      '--',
      filePath,
    ]).catch(() => '');
    const commits: FileHistoryEntry[] = [];
    for (const rec of out.split('\u001e')) {
      const [sha, subject, date, author, email, body] = rec
        .replace(/^\n/, '')
        .split(SEP);
      if (!sha) continue;
      commits.push({
        sha,
        short: sha.slice(0, 7),
        subject: subject ?? '',
        date: date ?? '',
        contributors: contributorsOf(author ?? '', email ?? '', body ?? ''),
      });
    }
    const remoteUrl = ctx.state().refs?.remoteUrl ?? null;
    const resolved = await Promise.all(
      commits.map(async (x) => ({
        ...x,
        contributors: await resolveAvatars(remoteUrl, x.sha, x.contributors),
      }))
    );
    return c.json<FileHistoryResponse>({ path: filePath, commits: resolved });
  });

  app.get('/api/file-info', async (c) => {
    if (!ctx.repoRoot) return c.json({ error: 'no repo' }, 400);
    const filePath = safeRelPath(c.req.query('path'));
    if (!filePath) return c.json({ error: 'not found' }, 404);
    const root = ctx.repoRoot;
    const part = c.req.query('part');
    const stat = async (): Promise<FileStatInfo> => {
      const [blob, st] = await Promise.all([
        git(root, ['rev-parse', `HEAD:${filePath}`]).catch(() => ''),
        fs.promises.stat(path.join(root, filePath)).catch(() => null),
      ]);
      return {
        path: filePath,
        size: st?.size ?? null,
        blob: blob.trim() || null,
        tracked: Boolean(blob.trim()),
      };
    };
    const history = async (): Promise<FileHistoryInfo> => {
      const SEP = '\u001f';
      const log = await git(root, [
        'log',
        '--follow',
        `--format=%H${SEP}%an${SEP}%aI${SEP}%s`,
        '--',
        filePath,
      ]).catch(() => '');
      const entries = log
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split(SEP))
        .filter((p) => p.length === 4)
        .map(([sha, author, date, subject]) => ({
          sha: sha!,
          author: author!,
          date: date!,
          subject: subject!,
        }));
      const byAuthor = new Map<string, number>();
      for (const e of entries)
        byAuthor.set(e.author, (byAuthor.get(e.author) ?? 0) + 1);
      return {
        path: filePath,
        commits: entries.length,
        authors: [...byAuthor]
          .map(([name, commits]) => ({ name, commits }))
          .sort((a, b) => b.commits - a.commits),
        first: entries.at(-1) ?? null,
        last: entries[0] ?? null,
      };
    };
    if (part === 'stat') return c.json<FileStatInfo>(await stat());
    if (part === 'history') return c.json<FileHistoryInfo>(await history());
    const [st, hi] = await Promise.all([stat(), history()]);
    return c.json<FileInfoResponse>({
      ...st,
      ...hi,
      tracked: st.tracked || hi.commits > 0,
    });
  });

  app.get('/api/raw', async (c) => {
    if (!ctx.repoRoot) return c.json({ error: 'no repo' }, 400);
    const filePath = safeRelPath(c.req.query('path'));
    if (!filePath) return c.json({ error: 'not found' }, 404);
    const state = ctx.state();
    if (!state.refs) return c.json({ error: 'unavailable' }, 503);
    const entry =
      state.files.find((f) => f.path === filePath || f.oldPath === filePath) ??
      null;
    const { rev, oldRev } = scopeRevs(parseScope(c.req.query('scope')), {
      refs: state.refs,
      comparison: state.comparison,
      statusDigest: ctx.statusDigest(),
    });
    const side = c.req.query('side');
    const useOld = side === 'old' || entry?.kind === 'deleted';
    const bytes = await getBlobBytes(
      ctx.repoRoot,
      useOld ? oldRev : rev,
      filePath
    );
    if (!bytes) return c.json({ error: 'not found' }, 404);
    const type = imageTypeOf(filePath);
    c.header('Content-Type', type ?? 'application/octet-stream');
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    if (type === 'image/svg+xml')
      c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    if (!type)
      c.header(
        'Content-Disposition',
        `attachment; filename="${path.basename(filePath).replace(/["\\]/g, '')}"`
      );
    return c.body(new Uint8Array(bytes));
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const frame = (ev: ServerEvent) =>
        JSON.stringify({ ...ev, hl: highlightStylesVersion() });
      const send = (ev: ServerEvent) => stream.writeSSE({ data: frame(ev) });
      await stream.writeSSE({
        data: frame({ type: 'hello', version: ctx.state().version }),
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
