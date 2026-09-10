export interface FuzzyMatch<T> {
  item: T;
  score: number;
  hits: number[];
}

export interface Indexed<T> {
  item: T;
  text: string;
  lower: string;
  base: number;
}

interface TermMatch {
  score: number;
  hits: number[];
}

const BOUNDARY = '/._-';

const scanFrom = (
  term: string,
  text: string,
  lower: string,
  base: number,
  start: number
): TermMatch | null => {
  const hits: number[] = [];
  let score = 0;
  let i = start;
  let prev = -2;
  for (const ch of term) {
    const at = lower.indexOf(ch, i);
    if (at === -1) return null;
    let gain = 1;
    if (at === prev + 1) gain += 6;
    if (at === 0 || BOUNDARY.includes(lower[at - 1] ?? '')) gain += 4;
    if (at >= base) gain += 3;
    score += gain;
    hits.push(at);
    prev = at;
    i = at + 1;
  }
  return { score: score - text.length * 0.05, hits };
};

const isBoundary = (lower: string, at: number): boolean =>
  at === 0 || BOUNDARY.includes(lower[at - 1] ?? '');

const substringMatch = (
  term: string,
  text: string,
  lower: string,
  base: number
): TermMatch | null => {
  let at = lower.indexOf(term, base);
  if (at === -1) at = lower.indexOf(term);
  if (at === -1) return null;
  const hits: number[] = [];
  for (let i = 0; i < term.length; i++) hits.push(at + i);
  let score = term.length * 7;
  if (isBoundary(lower, at)) score += 4;
  if (at >= base) score += 3;
  return { score: score - text.length * 0.05, hits };
};

const boundaryScan = (
  term: string,
  text: string,
  lower: string,
  base: number
): TermMatch | null => {
  const hits: number[] = [];
  let score = 0;
  let i = 0;
  for (const ch of term) {
    let at = lower.indexOf(ch, i);
    while (at !== -1 && !isBoundary(lower, at)) at = lower.indexOf(ch, at + 1);
    if (at === -1) return null;
    score += at >= base ? 8 : 5;
    hits.push(at);
    i = at + 1;
  }
  return { score: score - text.length * 0.05, hits };
};

const scanTerm = (
  term: string,
  text: string,
  lower: string,
  base: number,
  strict: boolean
): TermMatch | null => {
  if (strict)
    return (
      substringMatch(term, text, lower, base) ??
      boundaryScan(term, text, lower, base)
    );
  const whole = scanFrom(term, text, lower, base, 0);
  if (base === 0) return whole;
  const named = scanFrom(term, text, lower, base, base);
  if (!whole) return named;
  if (!named) return whole;
  return named.score >= whole.score ? named : whole;
};

const terms = (query: string): string[] =>
  query.toLowerCase().split(/\s+/).filter(Boolean);

const scoreIndexed = <T>(
  query: string[],
  entry: Indexed<T>,
  strict: boolean
): TermMatch | null => {
  let score = 0;
  const seen = new Set<number>();
  for (const term of query) {
    const m = scanTerm(term, entry.text, entry.lower, entry.base, strict);
    if (!m) return null;
    score += m.score;
    for (const h of m.hits) seen.add(h);
  }
  return { score, hits: [...seen].sort((a, b) => a - b) };
};

export const indexOne = <T>(item: T, text: string): Indexed<T> => ({
  item,
  text,
  lower: text.toLowerCase(),
  base: text.lastIndexOf('/') + 1,
});

export const fuzzyIndex = <T>(
  items: T[],
  textOf: (t: T) => string
): Indexed<T>[] => items.map((item) => indexOne(item, textOf(item)));

export function fuzzyScore(
  query: string,
  text: string
): { score: number; hits: number[] } | null {
  const q = terms(query);
  if (!q.length) return { score: 0, hits: [] };
  return scoreIndexed(q, indexOne(null, text), false);
}

export interface SearchOpts<T> {
  bonus?: (item: T) => number;
  strict?: boolean;
}

export function fuzzySearch<T>(
  index: Indexed<T>[],
  query: string,
  limit: number,
  opts: SearchOpts<T> = {}
): FuzzyMatch<T>[] {
  const { bonus, strict = false } = opts;
  const q = terms(query);
  if (!q.length)
    return index
      .slice(0, limit)
      .map(({ item }) => ({ item, score: 0, hits: [] }));
  const out: FuzzyMatch<T>[] = [];
  for (const entry of index) {
    const m = scoreIndexed(q, entry, strict);
    if (!m) continue;
    const extra = bonus ? bonus(entry.item) : 0;
    out.push({ item: entry.item, score: m.score + extra, hits: m.hits });
  }
  out.sort((a, b) => b.score - a.score);
  return out.length > limit ? out.slice(0, limit) : out;
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  textOf: (t: T) => string,
  limit: number
): FuzzyMatch<T>[] {
  return fuzzySearch(fuzzyIndex(items, textOf), query, limit);
}

export function segments(
  text: string,
  hits: number[]
): Array<{ text: string; hit: boolean }> {
  if (!hits.length) return [{ text, hit: false }];
  const set = new Set(hits);
  const out: Array<{ text: string; hit: boolean }> = [];
  let buf = '';
  let cur = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== cur) {
      out.push({ text: buf, hit: cur });
      buf = '';
      cur = hit;
    }
    buf += text[i];
  }
  out.push({ text: buf, hit: cur });
  return out.filter((s) => s.text);
}
