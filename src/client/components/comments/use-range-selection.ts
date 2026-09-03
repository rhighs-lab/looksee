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
  for (const el of document.querySelectorAll('.mq-range-line'))
    el.classList.remove('mq-range-line');
}

export function highlightRange(
  filePath: string,
  side: CommentSide,
  lo: number,
  hi: number
): void {
  clearRangeHighlight();
  if (hi <= lo) return;
  const file = document.querySelector(
    `.file[data-path="${CSS.escape(filePath)}"]`
  );
  if (!file) return;
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
  }
}

export function useRangeSelection(
  onPick: (pick: RangePick) => void,
  enabled: boolean
): { suppressNextClick: () => boolean } {
  const drag = useRef<{
    filePath: string;
    side: CommentSide;
    line: number;
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
      drag.current = {
        filePath: file.dataset['path'] ?? '',
        side: g.dataset['side'] as CommentSide,
        line: Number(g.dataset['commentLine']),
        moved: false,
      };
    };
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const row = (e.target as Element | null)?.closest('tr');
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
    };
    const onUp = (e: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      document.body.style.userSelect = '';
      if (!d?.moved) return;
      suppress.current = true;
      setTimeout(() => (suppress.current = false), 300);
      const row = (e.target as Element | null)?.closest('tr');
      const cell = row?.querySelector<HTMLElement>(
        `.commentable[data-side="${d.side}"]`
      );
      const end = cell ? Number(cell.dataset['commentLine']) : d.line;
      onPick({ filePath: d.filePath, side: d.side, a: d.line, b: end });
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
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
