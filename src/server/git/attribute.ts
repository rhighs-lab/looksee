import { parsePatch } from '@/server/git/diff-parser.js';
import { planScope, scopePatch } from '@/server/git/state.js';
import { isStaged, isUnstaged, type StatusEntry } from '@/server/git/status.js';
import type {
  FileDiff,
  Hunk,
  Layer,
  LineType,
  RepoRefs,
} from '@/shared/protocol.js';

export interface LayerSource {
  layer: Layer;
  hunks: Hunk[];
}

type Multiset = Map<string, number>;

const key = (content: string): string => content.replace(/\s+$/, '');

const bump = (m: Multiset, k: string): void => {
  m.set(k, (m.get(k) ?? 0) + 1);
};

const take = (m: Multiset, k: string): boolean => {
  const n = m.get(k) ?? 0;
  if (n === 0) return false;
  m.set(k, n - 1);
  return true;
};

export function attributeFile(
  file: FileDiff,
  srcs: LayerSource[],
  fallback: Layer | null
): void {
  const pools = srcs.map((s) => {
    const add: Multiset = new Map();
    const del: Multiset = new Map();
    for (const h of s.hunks)
      for (const l of h.lines) {
        if (l.type === 'add') bump(add, key(l.content));
        else if (l.type === 'del') bump(del, key(l.content));
      }
    return { layer: s.layer, add, del };
  });
  const pick = (type: LineType, k: string): Layer | null => {
    for (const p of pools)
      if (take(type === 'add' ? p.add : p.del, k)) return p.layer;
    return fallback;
  };
  for (const h of file.hunks)
    for (const l of h.lines) {
      if (l.type === 'context') continue;
      const layer = pick(l.type, key(l.content));
      if (layer) l.layer = layer;
    }
}

const COMMITTED: Layer[] = ['unstaged', 'staged', 'local', 'pushed'];

export async function attributeLayers(
  repoRoot: string,
  refs: RepoRefs,
  files: FileDiff[],
  status: StatusEntry[]
): Promise<void> {
  const paths = [
    ...new Set(
      files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))
    ),
  ];
  const byPath = new Map(status.map((e) => [e.path, e]));
  const byLayer = await Promise.all(
    COMMITTED.filter((l) => planScope(l, refs)).map(async (layer) => {
      const patch = await scopePatch(repoRoot, layer, refs, status, paths);
      const parsed = new Map(parsePatch(patch).map((f) => [f.path, f.hunks]));
      return { layer, parsed };
    })
  );
  for (const f of files) {
    const e = byPath.get(f.path);
    if (e?.unmerged || e?.untracked) {
      const layer: Layer = e.unmerged ? 'conflicted' : 'untracked';
      for (const h of f.hunks) for (const l of h.lines) l.layer = layer;
      continue;
    }
    const srcs: LayerSource[] = [];
    for (const { layer, parsed } of byLayer) {
      const hunks = parsed.get(f.path) ?? parsed.get(f.oldPath ?? '');
      if (hunks) srcs.push({ layer, hunks });
    }
    const fallback =
      e && isUnstaged(e)
        ? 'unstaged'
        : e && isStaged(e)
          ? 'staged'
          : (srcs[0]?.layer ?? null);
    attributeFile(f, srcs, fallback);
  }
}
