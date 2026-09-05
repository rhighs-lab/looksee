import { useEffect, useRef, useState } from 'react';
import { CommitRow, commitsFor } from '@/client/components/commits-menu.js';
import { useReview } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';

export function FileCommits({
  path,
  oldPath,
}: {
  path: string;
  oldPath?: string | null;
}) {
  const commits = useReview((s) => s.commits);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const mine = commitsFor(commits, path, oldPath);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!mine.length) return null;
  const label = mine.length === 1 ? mine[0]!.short : `${mine.length} commits`;
  return (
    <span className="commits-pop" ref={ref}>
      <Button
        small
        variant="invisible"
        className="file-commits-btn ui-mono"
        title={
          mine.length === 1
            ? mine[0]!.subject
            : `${mine.length} commits touched this file`
        }
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </Button>
      {open && (
        <div
          className="menu commit-card"
          role="dialog"
          aria-label={`Commits touching ${path}`}
        >
          {mine.map((c) => (
            <CommitRow c={c} key={c.sha} />
          ))}
        </div>
      )}
    </span>
  );
}
