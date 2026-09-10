import { useEffect, useRef } from 'react';
import type { CommentSide } from '@/shared/protocol.js';

export interface RangePick {
  filePath: string;
  side: CommentSide;
  a: number;
  b: number;
}

const gutterOf = (t: EventTarget | null): HTMLElement | null =>
  t instanceof Element ? t.closest<HTMLElement>('.blob-num.commentable') : null;

export function clearRangeHighlight(): void {
  for (const el of document.querySelectorAll(
    '.mq-range-line, .mq-range-first, .mq-range-last'
  ))
    el.classList.remove('mq-range-line', 'mq-range-first', 'mq-range-last');
}

export function highlightRange(
  filePath: string,
  side: CommentSide,
  lo: number,
  hi: number
): void {
  clearRangeHighlight();
  if (hi < lo) return;
  const file = document.querySelector(
    `.file[data-path="${CSS.escape(filePath)}"]`
  );
  if (!file) return;
  const rows: HTMLElement[] = [];
  for (let n = lo; n <= hi; n++) {
    const g = file.querySelector<HTMLElement>(
      `.blob-num.commentable[data-side="${side}"][data-comment-line="${n}"]`
    );
    if (!g) continue;
    g.classList.add('mq-range-line');
    const cells = [...(g.parentElement?.children ?? [])];
    const code = cells
      .slice(cells.indexOf(g) + 1)
      .find((c) => c.classList.contains('blob-code'));
    code?.classList.add('mq-range-line');
    if (code) rows.push(code as HTMLElement);
  }
  // the box around the block is drawn from its ends, the way GitHub does it
  rows[0]?.classList.add('mq-range-first');
  rows.at(-1)?.classList.add('mq-range-last');
}

/* The dragged range reads as one control: a bar that runs from the anchor line
   to the line under the cursor. It is an overlay on the file rather than a
   taller gutter button, because growing the button stretches its table cell and
   the cell then swallows every pointer event for the rows below it. */
function castBar(anchor: HTMLElement, target: HTMLElement): void {
  const file = anchor.closest<HTMLElement>('.file');
  if (!file) return;
  const f = file.getBoundingClientRect();
  const rects = [anchor, target].map((el) => el.getBoundingClientRect());
  const ends = rects[0]!.top <= rects[1]!.top ? rects : [rects[1]!, rects[0]!];
  const seen = new Set<string>();
  let n = 0;
  // GitHub marks the two ends of the block with a small +, not a tall bar
  for (const r of ends) {
    const key = `${Math.round(r.top)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let chip = file.querySelector<HTMLElement>(
      `:scope > .cast-plus[data-n="${n}"]`
    );
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'cast-plus';
      chip.dataset['n'] = String(n);
      chip.setAttribute('aria-hidden', 'true');
      chip.textContent = '+';
      file.appendChild(chip);
    }
    chip.style.left = `${rects[0]!.left - f.left + 2}px`;
    chip.style.top = `${r.top - f.top + (r.height - 18) / 2}px`;
    n++;
  }
  for (const extra of file.querySelectorAll<HTMLElement>(':scope > .cast-plus'))
    if (Number(extra.dataset['n']) >= n) extra.remove();
  document.documentElement.dataset['casting'] = '1';
}

function clearCast(): void {
  delete document.documentElement.dataset['casting'];
  for (const el of document.querySelectorAll('.cast-plus')) el.remove();
}

export function useRangeSelection(
  onPick: (pick: RangePick) => void,
  enabled: boolean
): { suppressNextClick: () => boolean } {
  const drag = useRef<{
    filePath: string;
    side: CommentSide;
    line: number;
    anchor: HTMLElement;
    moved: boolean;
  } | null>(null);
  const suppress = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const g = gutterOf(e.target);
      if (!g) return;
      const file = g.closest<HTMLElement>('.file');
      if (!file) return;
      const line = Number(g.dataset['commentLine']);
      const filePath = file.dataset['path'] ?? '';
      const side = g.dataset['side'] as CommentSide;
      drag.current = { filePath, side, line, anchor: g, moved: false };
      // the bar and the wash appear on press, not on the first move, so the
      // anchor line is already selected before the pointer travels
      highlightRange(filePath, side, line, line);
      castBar(g, g);
    };
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const row = e.target instanceof Element ? e.target.closest('tr') : null;
      const cell = row?.querySelector<HTMLElement>(
        `.commentable[data-side="${d.side}"]`
      );
      if (!cell) return;
      const line = Number(cell.dataset['commentLine']);
      if (line === d.line && !d.moved) return;
      d.moved = true;
      e.preventDefault();
      document.body.style.userSelect = 'none';
      highlightRange(
        d.filePath,
        d.side,
        Math.min(d.line, line),
        Math.max(d.line, line)
      );
      castBar(d.anchor, cell);
    };
    const onUp = (e: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      document.body.style.userSelect = '';
      clearCast();
      if (!d?.moved) return;
      suppress.current = true;
      setTimeout(() => (suppress.current = false), 300);
      const row = e.target instanceof Element ? e.target.closest('tr') : null;
      const cell = row?.querySelector<HTMLElement>(
        `.commentable[data-side="${d.side}"]`
      );
      const end = cell ? Number(cell.dataset['commentLine']) : d.line;
      onPick({ filePath: d.filePath, side: d.side, a: d.line, b: end });
    };
    const onLeave = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.userSelect = '';
      clearCast();
      clearRangeHighlight();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, [enabled, onPick]);

  return {
    suppressNextClick: () => {
      const s = suppress.current;
      suppress.current = false;
      return s;
    },
  };
}
