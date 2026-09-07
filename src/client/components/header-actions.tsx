import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/client/ui/index.js';

/** Keep secondary file actions available without wrapping the file header. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const header = ref.current?.closest('.file-header');
    if (!header) return;
    const observer = new ResizeObserver(() =>
      setCompact(header.clientWidth < 1000)
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  return (
    <span className="header-actions" ref={ref}>
      {compact && (
        <Button
          small
          icon
          aria-label="More file actions"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          …
        </Button>
      )}
      <span
        hidden={compact && !open}
        className={compact ? 'menu header-action-menu' : 'header-action-items'}
      >
        {children}
      </span>
    </span>
  );
}
