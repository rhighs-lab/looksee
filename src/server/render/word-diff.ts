import type { DiffLine, Hunk } from '@/shared/protocol.js';

export type Range = [number, number];

export interface WordLine extends DiffLine {
  wordRanges?: Range[];
}

function tokenize(s: string): string[] {
  return s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: Int32Array[] = Array.from(
    { length: n + 1 },
    () => new Int32Array(m + 1)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const matched: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matched.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return matched;
}

function unmatchedRanges(tokens: string[], matched: Set<number>): Range[] {
  const ranges: Range[] = [];
  let offset = 0;
  let curStart = -1;
  let curEnd = -1;
  tokens.forEach((tok, idx) => {
    const start = offset;
    const end = offset + tok.length;
    if (!matched.has(idx)) {
      if (curStart < 0) {
        curStart = start;
        curEnd = end;
      } else if (start === curEnd) curEnd = end;
      else {
        ranges.push([curStart, curEnd]);
        curStart = start;
        curEnd = end;
      }
    }
    offset = end;
  });
  if (curStart >= 0) ranges.push([curStart, curEnd]);
  return ranges;
}

export function computeWordDiff(
  oldStr: string,
  newStr: string
): { oldRanges: Range[]; newRanges: Range[] } {
  const a = tokenize(oldStr);
  const b = tokenize(newStr);
  const matches = lcsMatches(a, b);
  const commonChars = matches.reduce((sum, [i]) => sum + a[i]!.length, 0);
  const maxLen = Math.max(oldStr.length, newStr.length, 1);
  if (commonChars / maxLen < 0.2) return { oldRanges: [], newRanges: [] };
  return {
    oldRanges: unmatchedRanges(a, new Set(matches.map((mm) => mm[0]))),
    newRanges: unmatchedRanges(b, new Set(matches.map((mm) => mm[1]))),
  };
}

export function annotateWordDiffs(hunks: Hunk[]): void {
  for (const hunk of hunks) {
    const lines = hunk.lines as WordLine[];
    let i = 0;
    while (i < lines.length) {
      const cur = lines[i]!;
      if (cur.type !== 'del' && cur.type !== 'add') {
        i++;
        continue;
      }
      const dels: WordLine[] = [];
      const adds: WordLine[] = [];
      let j = i;
      while (
        j < lines.length &&
        (lines[j]!.type === 'del' || lines[j]!.type === 'add')
      ) {
        (lines[j]!.type === 'del' ? dels : adds).push(lines[j]!);
        j++;
      }
      const pairs = Math.min(dels.length, adds.length);
      for (let k = 0; k < pairs; k++) {
        const { oldRanges, newRanges } = computeWordDiff(
          dels[k]!.content,
          adds[k]!.content
        );
        dels[k]!.wordRanges = oldRanges;
        adds[k]!.wordRanges = newRanges;
      }
      i = j;
    }
  }
}
