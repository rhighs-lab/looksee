export interface FuzzyMatch<T> {
  item: T;
  score: number;
  hits: number[];
}

export function fuzzyScore(
  query: string,
  text: string
): { score: number; hits: number[] } | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let i = 0;
  let prev = -2;
  const base = text.lastIndexOf('/') + 1;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, i);
    if (at === -1) return null;
    let gain = 1;
    if (at === prev + 1) gain += 6;
    if (at === 0 || '/._-'.includes(t[at - 1] ?? '')) gain += 4;
    if (at >= base) gain += 3;
    score += gain;
    hits.push(at);
    prev = at;
    i = at + 1;
  }
  return { score: score - text.length * 0.05, hits };
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  textOf: (t: T) => string,
  limit: number
): FuzzyMatch<T>[] {
  const q = query.trim();
  if (!q)
    return items.slice(0, limit).map((item) => ({ item, score: 0, hits: [] }));
  const out: FuzzyMatch<T>[] = [];
  for (const item of items) {
    const m = fuzzyScore(q, textOf(item));
    if (m) out.push({ item, score: m.score, hits: m.hits });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
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
