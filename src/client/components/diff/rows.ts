import type { Expansions, LoadedSegment } from '@/client/store/review.js';
import type { DiffLine, FileDiff, Hunk } from '@/shared/protocol.js';

export const CHUNK = 20;

export type Dir = 'up' | 'down' | 'all';

export interface GapInfo {
  boundary: string;
  start: number;
  end: number;
  offset: number;
  dirs: Dir[];
  header: string;
}

export type Row =
  | { kind: 'line'; key: string; line: DiffLine; loaded: boolean }
  | {
      kind: 'pair';
      key: string;
      left: DiffLine | null;
      right: DiffLine | null;
      loaded: boolean;
    }
  | { kind: 'hunk'; key: string; header: string }
  | { kind: 'gap'; key: string; gap: GapInfo; trailing: boolean };

export interface Boundary {
  key: string;
  start: number;
  end: number;
  offset: number;
  trailing: boolean;
  header: string;
}

const hunkNewEnd = (h: Hunk): number => {
  for (let i = h.lines.length - 1; i >= 0; i--) {
    const n = h.lines[i]!.newNumber;
    if (n != null) return n;
  }
  return h.newStart - 1;
};

const hunkOldEnd = (h: Hunk): number => {
  for (let i = h.lines.length - 1; i >= 0; i--) {
    const n = h.lines[i]!.oldNumber;
    if (n != null) return n;
  }
  return h.oldStart - 1;
};

export function boundaries(diff: FileDiff): Boundary[] {
  const out: Boundary[] = [];
  let prevNewEnd = 0;
  diff.hunks.forEach((h, i) => {
    const gapAbove = h.newStart - 1 - prevNewEnd;
    out.push({
      key: `b${i}`,
      start: prevNewEnd + 1,
      end: gapAbove > 0 ? h.newStart - 1 : prevNewEnd,
      offset: h.oldStart - h.newStart,
      trailing: false,
      header: h.header,
    });
    prevNewEnd = hunkNewEnd(h);
  });
  const last = diff.hunks[diff.hunks.length - 1];
  if (
    last &&
    diff.kind !== 'deleted' &&
    diff.newLineCount != null &&
    diff.newLineCount > prevNewEnd
  ) {
    out.push({
      key: 'trailing',
      start: prevNewEnd + 1,
      end: diff.newLineCount,
      offset: hunkOldEnd(last) - prevNewEnd,
      trailing: true,
      header: '',
    });
  }
  return out;
}

export function dirsFor(start: number, end: number, boundary: Boundary): Dir[] {
  if (boundary.trailing) return ['down'];
  if (start === 1) return ['up'];
  return end - start + 1 <= CHUNK ? ['all'] : ['up', 'down'];
}

export function remainingGaps(
  b: Boundary,
  segments: LoadedSegment[]
): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  let cur = b.start;
  for (const seg of [...segments].sort((x, y) => x.from - y.from)) {
    if (seg.from > cur) gaps.push({ start: cur, end: seg.from - 1 });
    cur = Math.max(cur, seg.from + seg.lines.length);
  }
  if (cur <= b.end) gaps.push({ start: cur, end: b.end });
  return gaps;
}

function boundaryRows(
  b: Boundary,
  segments: LoadedSegment[],
  split: boolean,
  out: Row[]
): void {
  const sorted = [...segments].sort((x, y) => x.from - y.from);
  let cur = b.start;
  const pushGap = (start: number, end: number, withHeader: boolean) => {
    const gap: GapInfo = {
      boundary: b.key,
      start,
      end,
      offset: b.offset,
      dirs: dirsFor(start, end, b),
      header: withHeader ? b.header : '',
    };
    out.push({
      kind: 'gap',
      key: `${b.key}:${start}-${end}`,
      gap,
      trailing: b.trailing,
    });
  };
  for (const seg of sorted) {
    if (seg.from > cur) pushGap(cur, seg.from - 1, false);
    for (const line of seg.lines) {
      const key = `c${line.newNumber}`;
      out.push(
        split
          ? { kind: 'pair', key, left: line, right: line, loaded: true }
          : { kind: 'line', key, line, loaded: true }
      );
    }
    cur = Math.max(cur, seg.from + seg.lines.length);
  }
  if (cur <= b.end) pushGap(cur, b.end, true);
  else if (!b.trailing)
    out.push({ kind: 'hunk', key: `${b.key}:h`, header: b.header });
}

export function buildRows(
  diff: FileDiff,
  expansions: Expansions | undefined,
  split: boolean
): Row[] {
  const out: Row[] = [];
  const bs = boundaries(diff);
  diff.hunks.forEach((h, i) => {
    const b = bs[i]!;
    if (b.end >= b.start)
      boundaryRows(b, expansions?.[b.key] ?? [], split, out);
    else out.push({ kind: 'hunk', key: `${b.key}:h`, header: h.header });
    if (split) splitRows(h, out);
    else
      for (const line of h.lines)
        out.push({ kind: 'line', key: lineKey(line), line, loaded: false });
  });
  const trailing = bs.find((b) => b.trailing);
  if (trailing)
    boundaryRows(trailing, expansions?.[trailing.key] ?? [], split, out);
  return out;
}

const lineKey = (l: DiffLine): string =>
  `${l.type[0]}${l.oldNumber ?? ''}-${l.newNumber ?? ''}`;

function splitRows(h: Hunk, out: Row[]): void {
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const left = dels[i] ?? null;
      const right = adds[i] ?? null;
      out.push({
        kind: 'pair',
        key: `p${left?.oldNumber ?? ''}-${right?.newNumber ?? ''}`,
        left,
        right,
        loaded: false,
      });
    }
    dels = [];
    adds = [];
  };
  for (const line of h.lines) {
    if (line.type === 'del') dels.push(line);
    else if (line.type === 'add') adds.push(line);
    else {
      flush();
      out.push({
        kind: 'pair',
        key: lineKey(line),
        left: line,
        right: line,
        loaded: false,
      });
    }
  }
  flush();
}

export function rangeFor(
  dir: Dir | 'mid',
  start: number,
  end: number,
  around?: number
): { from: number; to: number } {
  if (dir === 'all') return { from: start, to: end };
  if (dir === 'down')
    return { from: start, to: Math.min(end, start + CHUNK - 1) };
  if (dir === 'up') return { from: Math.max(start, end - CHUNK + 1), to: end };
  const n = around ?? start;
  let from = Math.max(start, n - Math.floor(CHUNK / 2));
  const to = Math.min(end, from + CHUNK - 1);
  from = Math.max(start, to - CHUNK + 1);
  return { from, to };
}
