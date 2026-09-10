import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/client/ui/index.js';

/** Secondary file actions fold into a menu when the header runs out of room. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
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
    <span className="header-actions" ref={ref} data-open={open ? '1' : '0'}>
      <Button
        small
        icon
        className="header-actions-more"
        aria-label="More file actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        …
      </Button>
      <span className="header-action-items">{children}</span>
    </span>
  );
}
