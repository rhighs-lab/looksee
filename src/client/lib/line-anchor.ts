export interface LineRange {
  lo: number;
  hi: number;
}

export function parseLineHash(hash: string): LineRange | null {
  const m = /^#L(\d+)(?:-L?(\d+))?$/.exec(hash);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

export const lineHash = ({ lo, hi }: LineRange): string =>
  hi > lo ? `#L${lo}-L${hi}` : `#L${lo}`;

export function paintLineRange(range: LineRange | null): HTMLElement | null {
  for (const el of document.querySelectorAll('.blob-line-hl'))
    el.classList.remove('blob-line-hl');
  if (!range) return null;
  let first: HTMLElement | null = null;
  for (let n = range.lo; n <= range.hi; n++) {
    const cell = document.querySelector<HTMLElement>(
      `.blob-view .blob-num[data-line-number="${n}"]`
    );
    const row = cell?.parentElement;
    if (!row) continue;
    for (const td of row.children) td.classList.add('blob-line-hl');
    first ??= row as HTMLElement;
  }
  return first;
}
