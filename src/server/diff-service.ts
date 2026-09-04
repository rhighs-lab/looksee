import { getLineCount } from '@/server/git/blobs.js';
import { parsePatch } from '@/server/git/diff-parser.js';
import { indexTree, snapshotWorktree } from '@/server/git/snapshot.js';
import { planScope, readStatus, scopePatch } from '@/server/git/state.js';
import { highlightHunks } from '@/server/render/highlighter.js';
import { annotateWordDiffs } from '@/server/render/word-diff.js';
import type {
  FileDiff,
  RepoRefs,
  ResolvedComparison,
  Rev,
  Scope,
} from '@/shared/protocol.js';
import { LARGE_DIFF_LINES } from '@/shared/protocol.js';

export interface DiffCtx {
  refs: RepoRefs;
  comparison: ResolvedComparison | null;
}

export function scopeRevs(
  scope: Scope,
  ctx: DiffCtx
): { rev: Rev; oldRev: Rev } {
  const { refs, comparison: cmp } = ctx;
  const live = refs.head.checkedOut;
  if (scope === 'cumulative' && cmp)
    return {
      rev:
        cmp.endpoint.kind === 'worktree' && live
          ? 'WORKTREE'
          : cmp.endpoint.oid,
      oldRev: cmp.baseline.oid,
    };
  const plan = scope === 'cumulative' ? null : planScope(scope, refs);
  if (!plan) return { rev: live ? 'WORKTREE' : refs.head.sha, oldRev: 'HEAD' };
  return { rev: plan.to, oldRev: plan.from };
}

export interface BuildOpts {
  paths?: string[];
  full?: boolean;
}

async function freshen(
  repoRoot: string,
  ctx: DiffCtx,
  paths: string[]
): Promise<ResolvedComparison | null> {
  const cmp = ctx.comparison;
  if (!cmp || !ctx.refs.head.checkedOut) return cmp;
  const ep = cmp.endpoint;
  if (ep.kind !== 'worktree' && ep.kind !== 'index') return cmp;
  const oid =
    (ep.kind === 'index' ? await indexTree(repoRoot) : null) ??
    (await snapshotWorktree(repoRoot, paths));
  return { ...cmp, endpoint: { ...ep, oid } };
}

export async function buildFileDiffs(
  repoRoot: string,
  scope: Scope,
  ctx: DiffCtx,
  opts: BuildOpts = {}
): Promise<FileDiff[]> {
  const paths = opts.paths ?? [];
  const status = await readStatus(repoRoot);
  const patch = await scopePatch(
    repoRoot,
    scope,
    ctx.refs,
    status,
    paths,
    scope === 'cumulative' ? await freshen(repoRoot, ctx, paths) : null
  );
  const { rev, oldRev } = scopeRevs(scope, ctx);
  const parsed = parsePatch(patch);
  const out: FileDiff[] = [];
  for (const f of parsed) {
    const lineCount = f.hunks.reduce((n, h) => n + h.lines.length, 0);
    const truncated = !opts.full && lineCount > LARGE_DIFF_LINES;
    const hunks = truncated ? [] : f.hunks;
    if (!f.binary && !truncated) {
      annotateWordDiffs(hunks);
      await highlightHunks(hunks, f.language);
    }
    const newLineCount =
      f.binary || f.kind === 'deleted'
        ? null
        : await getLineCount(repoRoot, rev, f.path);
    out.push({ ...f, hunks, newLineCount, rev, oldRev, truncated });
  }
  return out;
}
