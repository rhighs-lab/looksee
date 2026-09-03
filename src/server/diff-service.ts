import { getLineCount } from '@/server/git/blobs.js';
import { parsePatch } from '@/server/git/diff-parser.js';
import { planScope, readStatus, scopePatch } from '@/server/git/state.js';
import { highlightHunks } from '@/server/render/highlighter.js';
import { annotateWordDiffs } from '@/server/render/word-diff.js';
import type { FileDiff, RepoRefs, Rev, Scope } from '@/shared/protocol.js';
import { LARGE_DIFF_LINES } from '@/shared/protocol.js';

export function scopeRevs(
  scope: Scope,
  refs: RepoRefs
): { rev: Rev; oldRev: Rev } {
  const plan = planScope(scope, refs);
  if (!plan)
    return {
      rev: refs.head.checkedOut ? 'WORKTREE' : refs.head.sha,
      oldRev: 'HEAD',
    };
  return { rev: plan.to, oldRev: plan.from };
}

export interface BuildOpts {
  paths?: string[];
  full?: boolean;
}

export async function buildFileDiffs(
  repoRoot: string,
  scope: Scope,
  refs: RepoRefs,
  opts: BuildOpts = {}
): Promise<FileDiff[]> {
  const status = await readStatus(repoRoot);
  const patch = await scopePatch(
    repoRoot,
    scope,
    refs,
    status,
    opts.paths ?? []
  );
  const { rev, oldRev } = scopeRevs(scope, refs);
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
