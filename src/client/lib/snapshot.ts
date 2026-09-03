import type { Expansions } from '@/client/store/review.js';
import type { FileDiff } from '@/shared/protocol.js';

export type Side = 'old' | 'new';

export function lineMap(
  diff: FileDiff | undefined,
  expansions: Expansions | undefined,
  side: Side
): Map<number, string> {
  const m = new Map<number, string>();
  if (!diff) return m;
  for (const h of diff.hunks) {
    for (const l of h.lines) {
      const n = side === 'old' ? l.oldNumber : l.newNumber;
      if (n != null && (side === 'old' ? l.type !== 'add' : l.type !== 'del'))
        m.set(n, l.content);
    }
  }
  for (const segs of Object.values(expansions ?? {})) {
    for (const seg of segs) {
      for (const l of seg.lines) {
        const n = side === 'old' ? l.oldNumber : l.newNumber;
        if (n != null) m.set(n, l.content);
      }
    }
  }
  return m;
}

export function snapshotForRange(
  diff: FileDiff | undefined,
  expansions: Expansions | undefined,
  side: Side,
  lo: number,
  hi: number
): string[] {
  const m = lineMap(diff, expansions, side);
  const out: string[] = [];
  for (let n = lo; n <= hi; n++) {
    const s = m.get(n);
    if (s !== undefined) out.push(s);
  }
  return out.length ? out : [''];
}
