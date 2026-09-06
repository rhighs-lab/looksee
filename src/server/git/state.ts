import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  driftOf,
  labelOf,
  resolveComparison,
  resolveEndpoint,
} from '@/server/git/comparison.js';
import {
  conflictPatch,
  diffPatch,
  listUntracked,
  nameStatus,
  treeDiffPatch,
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
import { tildify } from '@/shared/home.js';
import type {
  ChangedFile,
  ChangeKind,
  Comparison,
  ComparisonNote,
  Endpoint,
  Layer,
  LayerChange,
  Pin,
  RepoRefs,
  RepoState,
  RepoSummary,
  ResolvedComparison,
  Scope,
  ScopePreset,
  Session,
} from '@/shared/protocol.js';
import { LARGE_DIFF_LINES, LAYERS } from '@/shared/protocol.js';

export interface StateOpts {
  preset: ScopePreset;
  custom: Comparison | null;
  session: Session | null;
  baseFlag: string | null;
  headRef?: string | null;
  status?: StatusEntry[];
}

export interface ScopePlan {
  from: string | 'INDEX';
  to: string | 'INDEX' | 'WORKTREE';
  untracked: boolean;
  conflicted: boolean;
}

export function planScope(scope: Layer, refs: RepoRefs): ScopePlan | null {
  const mb = refs.mergeBase ?? refs.base.sha ?? 'HEAD';
  const live = refs.head.checkedOut;
  const tip = live ? 'HEAD' : refs.head.sha;
  switch (scope) {
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

async function isAncestor(
  repoRoot: string,
  older: string,
  newer: string
): Promise<boolean> {
  try {
    await git(repoRoot, ['merge-base', '--is-ancestor', older, newer]);
    return true;
  } catch {
    return false;
  }
}

async function clampToBaseline(
  repoRoot: string,
  plan: ScopePlan | null,
  cmp: ResolvedComparison | null
): Promise<ScopePlan | null> {
  const base = cmp?.baseline.commit;
  if (!plan || !base || plan.from === 'INDEX') return plan;
  return (await isAncestor(repoRoot, plan.from, base))
    ? { ...plan, from: base }
    : plan;
}

export async function scopePatch(
  repoRoot: string,
  scope: Scope,
  refs: RepoRefs,
  status: StatusEntry[],
  paths: string[] = [],
  cmp: ResolvedComparison | null = null
): Promise<string> {
  if (scope === 'cumulative') {
    if (!cmp) throw new Error('no comparison');
    return treeDiffPatch(repoRoot, cmp.baseline.oid, cmp.endpoint.oid, paths);
  }
  const plan =
    scope === 'local' || scope === 'pushed'
      ? await clampToBaseline(repoRoot, planScope(scope, refs), cmp)
      : planScope(scope, refs);
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

export function layersInComparison(
  cmp: ResolvedComparison,
  refs: RepoRefs
): Set<Layer> {
  const stage = (k: Endpoint['kind']) =>
    k === 'worktree' ? 2 : k === 'index' ? 1 : 0;
  const b = stage(cmp.baseline.kind);
  const e = stage(cmp.endpoint.kind);
  const out = new Set<Layer>();
  if (b === 0 && cmp.baseline.commit !== refs.head.sha) {
    out.add('local');
    out.add('pushed');
  }
  if (b === 0 && e >= 1) out.add('staged');
  if (b <= 1 && e >= 2) out.add('unstaged');
  if (e >= 2) {
    out.add('untracked');
    out.add('conflicted');
  }
  return out;
}

export function composeFiles(
  cumulative: ParsedFile[],
  status: StatusEntry[],
  local: { path: string; oldPath: string | null; code: string }[],
  pushed: { path: string; oldPath: string | null; code: string }[],
  allow: Set<Layer> | null = null
): ChangedFile[] {
  const layersByPath = new Map<string, LayerChange[]>();
  const add = (p: string, lc: LayerChange) => {
    if (allow && !allow.has(lc.layer)) return;
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
    if (!layers.length) continue;
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
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
    '--renames',
  ]);
  return parseStatus(out);
}

const inTree = (e: StatusEntry): boolean =>
  e.untracked || e.unmerged || e.worktree !== '.';

export async function statusDigest(
  repoRoot: string,
  status: StatusEntry[]
): Promise<string> {
  const stats = await Promise.all(
    status.filter(inTree).map((e) =>
      fs.stat(path.join(repoRoot, e.path)).then(
        (st) => `${st.mtimeMs}:${st.size}`,
        () => 'gone'
      )
    )
  );
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([status, stats]))
    .digest('hex');
}

const pinsOf = (cmp: Comparison, session: Session | null): Pin[] =>
  [cmp.baseline, cmp.endpoint].flatMap((ep: Endpoint) => {
    const pin = ep.kind === 'pin' ? session?.[`${ep.name}At`] : null;
    return pin ? [pin] : [];
  });

async function resolveTrees(
  repoRoot: string,
  opts: StateOpts,
  refs: RepoRefs,
  status: StatusEntry[]
): Promise<{ comparison: ResolvedComparison; drift: boolean }> {
  const { preset, session } = opts;
  const cmp = resolveComparison(preset, opts.custom, session, refs);
  const ctx = { session, head: refs.head };
  const baseline = await resolveEndpoint(repoRoot, cmp.baseline, ctx);
  const endpoint = await resolveEndpoint(repoRoot, cmp.endpoint, ctx);
  const unmerged = status.some((e) => e.unmerged);
  const hasIndex = [cmp.baseline, cmp.endpoint].some((e) => e.kind === 'index');
  const note: ComparisonNote =
    preset === 'branch' && refs.mergeBase === refs.head.sha
      ? 'same-as-working'
      : hasIndex && unmerged
        ? 'index-unmerged'
        : null;
  const drifts = await Promise.all(
    pinsOf(cmp, session).map((pin) => driftOf(repoRoot, pin, refs.head.sha))
  );
  return {
    comparison: {
      preset,
      baseline,
      endpoint,
      label: labelOf(cmp, { baseline, endpoint }),
      note,
    },
    drift: drifts.some(Boolean),
  };
}

export async function computeRepoState(
  repoRoot: string,
  opts: StateOpts,
  version: number
): Promise<RepoState> {
  const refs = await getRefs(repoRoot, opts.baseFlag, opts.headRef ?? null);
  const status = refs.head.checkedOut
    ? (opts.status ?? (await readStatus(repoRoot)))
    : [];
  const { comparison, drift } = await resolveTrees(
    repoRoot,
    opts,
    refs,
    status
  );
  const [localPlan, pushedPlan] = await Promise.all([
    clampToBaseline(repoRoot, planScope('local', refs), comparison),
    clampToBaseline(repoRoot, planScope('pushed', refs), comparison),
  ]);
  const [cumulativeText, local, pushed] = await Promise.all([
    scopePatch(repoRoot, 'cumulative', refs, status, [], comparison),
    localPlan && refs.head.sha && localPlan.from !== 'INDEX'
      ? nameStatus(repoRoot, localPlan.from, localPlan.to).catch(() => [])
      : Promise.resolve([]),
    pushedPlan
      ? nameStatus(repoRoot, pushedPlan.from, pushedPlan.to).catch(() => [])
      : Promise.resolve([]),
  ]);
  const files = composeFiles(
    parsePatch(cumulativeText),
    status,
    local,
    pushed,
    comparison ? layersInComparison(comparison, refs) : null
  );
  return {
    version,
    repoRoot,
    repoLabel: tildify(repoRoot, os.homedir()),
    title: null,
    refs,
    comparison,
    drift,
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
  const c = s.comparison;
  const cmpPart = c
    ? [c.preset, c.baseline.oid, c.endpoint.oid, c.note, s.drift].join('|')
    : '';
  const filePart = s.files
    .map(
      (f) =>
        `${f.path}:${f.kind}:${f.digest}:${f.layers.map((l) => l.layer + l.kind).join(',')}`
    )
    .join(';');
  return `${refPart}#${cmpPart}#${filePart}`;
}
