import type { FileDiff } from '@/shared/protocol.js';

export interface ArrivedLine {
  content: string;
  seq: number;
}

/** Refreshes closer together than this belong to the same arrival. */
export const QUIET_GAP_MS = 2000;

export function addedContents(diff: FileDiff | undefined): string[] {
  if (!diff) return [];
  const out: string[] = [];
  for (const hunk of diff.hunks)
    for (const line of hunk.lines)
      if (line.type === 'add') out.push(line.content);
  return out;
}

const countBy = (xs: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

/**
 * Added lines in `next` that `prev` cannot account for.
 *
 * Comparison is by content against a multiset, never by line number: inserting
 * a line shifts every number below it, so a number-keyed comparison would
 * report the whole remainder of the file as new. The multiset also keeps
 * duplicate lines honest — three identical lines before and two after is a
 * removal, not an arrival.
 */
export function newArrivals(
  prev: FileDiff | undefined,
  next: FileDiff
): string[] {
  if (!prev) return [];
  const budget = countBy(addedContents(prev));
  const out: string[] = [];
  for (const content of addedContents(next)) {
    const left = budget.get(content) ?? 0;
    if (left > 0) budget.set(content, left - 1);
    else out.push(content);
  }
  return out;
}

export function nextArrivalSeq(
  seq: number,
  lastAt: number | null,
  now: number
): number {
  return lastAt !== null && now - lastAt <= QUIET_GAP_MS ? seq : seq + 1;
}

export type MarkIndex = Map<string, number[]>;

export function markIndex(lines: ArrivedLine[]): MarkIndex {
  const idx: MarkIndex = new Map();
  for (const { content, seq } of lines) {
    const seqs = idx.get(content);
    if (seqs) seqs.push(seq);
    else idx.set(content, [seq]);
  }
  for (const seqs of idx.values()) seqs.sort((a, b) => a - b);
  return idx;
}

/** Consuming lookup, so N stored copies mark exactly N rendered rows. */
export function takeMark(idx: MarkIndex, content: string): number | undefined {
  return idx.get(content)?.shift();
}
