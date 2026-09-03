import {
  conflictPatch,
  diffPatch,
  listUntracked,
  nameStatus,
  untrackedPatch,
} from '@/server/git/diff.js';
import { type ParsedFile, parsePatch } from '@/server/git/diff-parser.js';
import { git } from '@/server/git/exec.js';
import { isGeneratedPath } from '@/server/git/generated.js';
import { getRefs } from '@/server/git/refs.js';
import {
  isStaged,
  isUnstaged,
  kindFromCode,
  parseStatus,
  type StatusEntry,
} from '@/server/git/status.js';
import type {
  ChangedFile,
  ChangeKind,
  Layer,
  LayerChange,
  RepoRefs,
  RepoState,
  RepoSummary,
  Scope,
} from '@/shared/protocol.js';
import { LARGE_DIFF_LINES, LAYERS } from '@/shared/protocol.js';

export interface StateOpts {
  baseFlag: string | null;
  headRef?: string | null;
}

export interface ScopePlan {
  from: string | 'INDEX';
  to: string | 'INDEX' | 'WORKTREE';
  untracked: boolean;
  conflicted: boolean;
}

export function planScope(scope: Scope, refs: RepoRefs): ScopePlan | null {
  const mb = refs.mergeBase ?? refs.base.sha ?? 'HEAD';
  const live = refs.head.checkedOut;
  const tip = live ? 'HEAD' : refs.head.sha;
  switch (scope) {
    case 'cumulative':
      return live
        ? { from: mb, to: 'WORKTREE', untracked: true, conflicted: false }
        : { from: mb, to: tip, untracked: false, conflicted: false };
    case 'unstaged':
      return live
        ? { from: 'INDEX', to: 'WORKTREE', untracked: false, conflicted: true }
        : null;
    case 'staged':
      return live
        ? { from: 'HEAD', to: 'INDEX', untracked: false, conflicted: false }
        : null;
    case 'untracked':
      return live
        ? { from: 'HEAD', to: 'WORKTREE', untracked: true, conflicted: false }
        : null;
    case 'conflicted':
      return live
        ? { from: 'HEAD', to: 'WORKTREE', untracked: false, conflicted: true }
        : null;
    case 'local': {
      const from = refs.upstream ? refs.upstream.mergeBase : mb;
      return { from, to: tip, untracked: false, conflicted: false };
    }
    case 'pushed': {
      if (!refs.upstream || !refs.pushedBase) return null;
      return {
        from: refs.pushedBase,
        to: refs.upstream.sha,
        untracked: false,
        conflicted: false,
      };
    }
  }
}

export async function scopePatch(
  repoRoot: string,
  scope: Scope,
  refs: RepoRefs,
  status: StatusEntry[],
  paths: string[] = []
): Promise<string> {
  const plan = planScope(scope, refs);
  if (!plan) return '';
  const want = paths.length ? new Set(paths) : null;
  const conflicted = status.filter((e) => e.unmerged).map((e) => e.path);
  const pick = (list: string[]) =>
    want ? list.filter((p) => want.has(p)) : list;
  let patch = '';
  if (!(scope === 'untracked' || scope === 'conflicted')) {
    patch = await diffPatch(repoRoot, { from: plan.from, to: plan.to }, paths);
  }
  if (plan.untracked)
    patch += await untrackedPatch(
      repoRoot,
      pick(await listUntracked(repoRoot))
    );
  if (plan.conflicted && conflicted.length)
    patch += await conflictPatch(repoRoot, 'HEAD', pick(conflicted));
  return patch;
}

function layerKind(e: StatusEntry, side: 'index' | 'worktree'): ChangeKind {
  return kindFromCode(side === 'index' ? e.index : e.worktree);
}

export function composeFiles(
  cumulative: ParsedFile[],
  status: StatusEntry[],
  local: { path: string; oldPath: string | null; code: string }[],
  pushed: { path: string; oldPath: string | null; code: string }[]
): ChangedFile[] {
  const layersByPath = new Map<string, LayerChange[]>();
  const add = (p: string, lc: LayerChange) => {
    const list = layersByPath.get(p) ?? [];
    list.push(lc);
    layersByPath.set(p, list);
  };
  for (const n of pushed)
    add(n.path, {
      layer: 'pushed',
      kind: kindFromCode(n.code),
      oldPath: n.oldPath,
    });
  for (const n of local)
    add(n.path, {
      layer: 'local',
      kind: kindFromCode(n.code),
      oldPath: n.oldPath,
    });
  for (const e of status) {
    if (e.ignored) continue;
    if (e.unmerged)
      add(e.path, { layer: 'conflicted', kind: 'unmerged', oldPath: null });
    else if (e.untracked)
      add(e.path, { layer: 'untracked', kind: 'added', oldPath: null });
    else {
      if (isStaged(e))
        add(e.path, {
          layer: 'staged',
          kind: layerKind(e, 'index'),
          oldPath: e.origPath,
        });
      if (isUnstaged(e))
        add(e.path, {
          layer: 'unstaged',
          kind: layerKind(e, 'worktree'),
          oldPath: null,
        });
    }
  }

  const seen = new Set<string>();
  const out: ChangedFile[] = [];
  for (const f of cumulative) {
    seen.add(f.path);
    const layers =
      layersByPath.get(f.path) ??
      (f.oldPath ? (layersByPath.get(f.oldPath) ?? []) : []);
    const conflicted = layers.some((l) => l.layer === 'conflicted');
    const lineCount = f.hunks.reduce((n, h) => n + h.lines.length, 0);
    out.push({
      path: f.path,
      oldPath: f.oldPath,
      kind: conflicted ? 'unmerged' : f.kind,
      layers,
      binary: f.binary,
      additions: f.additions,
      deletions: f.deletions,
      digest: f.digest,
      generated: isGeneratedPath(f.path),
      large: lineCount > LARGE_DIFF_LINES,
    });
  }
  for (const [p, layers] of layersByPath) {
    if (seen.has(p)) continue;
    if (layers.every((l) => l.layer === 'pushed')) continue;
    out.push({
      path: p,
      oldPath: null,
      kind: layers.some((l) => l.layer === 'conflicted')
        ? 'unmerged'
        : 'unchanged',
      layers,
      binary: false,
      additions: 0,
      deletions: 0,
      digest: 'unchanged',
      generated: isGeneratedPath(p),
      large: false,
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function summarize(files: ChangedFile[]): RepoSummary {
  const byLayer = Object.fromEntries(LAYERS.map((l) => [l, 0])) as Record<
    Layer,
    number
  >;
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
    for (const l of new Set(f.layers.map((x) => x.layer))) byLayer[l]++;
  }
  const changed = files.filter((f) => f.kind !== 'unchanged').length;
  return { files: changed, additions, deletions, byLayer };
}

export async function readStatus(repoRoot: string): Promise<StatusEntry[]> {
  const out = await git(repoRoot, [
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
    '--renames',
  ]);
  return parseStatus(out);
}

export async function computeRepoState(
  repoRoot: string,
  opts: StateOpts,
  version: number
): Promise<RepoState> {
  const refs = await getRefs(repoRoot, opts.baseFlag, opts.headRef ?? null);
  const status = refs.head.checkedOut ? await readStatus(repoRoot) : [];
  const localPlan = planScope('local', refs);
  const pushedPlan = planScope('pushed', refs);
  const [cumulativeText, local, pushed] = await Promise.all([
    scopePatch(repoRoot, 'cumulative', refs, status),
    localPlan && refs.head.sha && localPlan.from !== 'INDEX'
      ? nameStatus(repoRoot, localPlan.from, localPlan.to).catch(() => [])
      : Promise.resolve([]),
    pushedPlan
      ? nameStatus(repoRoot, pushedPlan.from, pushedPlan.to).catch(() => [])
      : Promise.resolve([]),
  ]);
  const files = composeFiles(parsePatch(cumulativeText), status, local, pushed);
  return {
    version,
    repoRoot,
    refs,
    files,
    summary: summarize(files),
    computedAt: new Date().toISOString(),
    error: null,
  };
}

export function stateFingerprint(s: RepoState): string {
  const r = s.refs;
  const refPart = r
    ? [
        r.head.sha,
        r.head.branch,
        r.head.checkedOut,
        r.base.ref,
        r.base.sha,
        r.mergeBase,
        r.upstream?.sha,
        r.upstream?.ahead,
        r.upstream?.behind,
        r.lastFetchAt,
      ].join('|')
    : 'norepo';
  const filePart = s.files
    .map(
      (f) =>
        `${f.path}:${f.kind}:${f.digest}:${f.layers.map((l) => l.layer + l.kind).join(',')}`
    )
    .join(';');
  return `${refPart}#${filePart}`;
}
