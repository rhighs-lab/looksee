import { useEffect } from 'react';
import { useReview } from '@/client/store/review.js';

const subnavBottom = (): number =>
  document.querySelector('.pr-subnav')?.getBoundingClientRect().bottom ?? 0;

const currentCard = (cards: HTMLElement[], line: number): string | null => {
  let lo = 0;
  let hi = cards.length - 1;
  let found: HTMLElement | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const el = cards[mid]!;
    if (el.getBoundingClientRect().bottom >= line) {
      found = el;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return found?.dataset['path'] ?? null;
};

export function useActiveFileSpy(paths: string[]): void {
  const setActivePath = useReview((s) => s.setActivePath);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('main.diff-container');
    if (!main || !paths.length) return;
    let raf = 0;
    let last: string | null = null;
    const pick = () => {
      raf = 0;
      const cards = [...main.querySelectorAll<HTMLElement>('.file[data-path]')];
      const path = currentCard(cards, subnavBottom() + 12);
      if (path === null || path === last) return;
      last = path;
      setActivePath(path);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(pick);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [paths, setActivePath]);
}

const reduced = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function revealTreeRow(el: HTMLElement | null): void {
  if (!el) return;
  const list = el.closest<HTMLElement>('.file-tree');
  if (!list) return;
  const row = el.getBoundingClientRect();
  const box = list.getBoundingClientRect();
  const pad = Math.min(48, box.height / 4);
  if (row.top >= box.top + pad && row.bottom <= box.bottom - pad) return;
  const top =
    list.scrollTop + (row.top - box.top) - box.height / 2 + row.height / 2;
  list.scrollTo({ top, behavior: reduced() ? 'auto' : 'smooth' });
}
