import { useEffect, useRef, useState } from 'react';
import { relativeTime } from '@/client/lib/format.js';
import { useReview } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';
import type { ReviewCommit } from '@/shared/protocol.js';

export function commitsFor(
  commits: ReviewCommit[],
  path: string,
  oldPath?: string | null
): ReviewCommit[] {
  return commits.filter(
    (c) =>
      c.files.includes(path) || (oldPath ? c.files.includes(oldPath) : false)
  );
}

export function CommitRow({ c }: { c: ReviewCommit }) {
  return (
    <div className="commit-row">
      <span className="commit-sha ui-mono">{c.short}</span>
      <span className="commit-subject" title={c.subject}>
        {c.subject}
      </span>
      <span className="commit-meta ui-muted">
        {c.author} · {relativeTime(c.date)}
      </span>
    </div>
  );
}

export function CommitsMenu() {
  const commits = useReview((s) => s.commits);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

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

  if (!commits.length) return null;
  return (
    <span className="commits-pop" ref={ref}>
      <Button
        small
        variant="invisible"
        title="Commits in this comparison"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
      </Button>
      {open && (
        <div className="menu commit-card" role="dialog" aria-label="Commits">
          {commits.map((c) => (
            <CommitRow c={c} key={c.sha} />
          ))}
        </div>
      )}
    </span>
  );
}
