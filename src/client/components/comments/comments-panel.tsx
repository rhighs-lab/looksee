import { useEffect } from 'react';
import { Thread } from '@/client/components/comments/thread.js';
import { Close, CommentIcon } from '@/client/components/icons.js';
import { useComments } from '@/client/store/comments.js';
import { useReview } from '@/client/store/review.js';
import { Button, Counter } from '@/client/ui/index.js';

const jumpTo = (rootId: string): void => {
  const el = document.querySelector(`[data-root-id="${rootId}"]`);
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
};

export function CommentsPanelToggle() {
  const open = useReview((s) => s.commentsPanel);
  const setOpen = useReview((s) => s.setCommentsPanel);
  const count = useComments(
    (s) =>
      Object.values(s.threads).filter((t) => t.root.status !== 'resolved')
        .length
  );
  if (!count) return null;
  return (
    <Button
      small
      variant="invisible"
      title="Show every comment in this review"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <CommentIcon width={14} height={14} />
      <Counter n={count} />
    </Button>
  );
}

export function CommentsPanel() {
  const open = useReview((s) => s.commentsPanel);
  const setOpen = useReview((s) => s.setCommentsPanel);
  const threads = useComments((s) => s.threads);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const all = Object.values(threads).sort(
    (a, b) =>
      a.root.filePath.localeCompare(b.root.filePath) ||
      a.root.startLine - b.root.startLine
  );
  const openCount = all.filter((t) => t.root.status !== 'resolved').length;

  return (
    <>
      <div
        className="panel-scrim"
        data-open={open ? '1' : '0'}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        className="comments-panel"
        data-open={open ? '1' : '0'}
        aria-label="All comments"
        aria-hidden={!open}
        inert={!open}
      >
        <header className="comments-panel-head">
          <span>
            {openCount} open · {all.length - openCount} resolved
          </span>
          <Button
            variant="invisible"
            icon
            small
            title="Close"
            aria-label="Close comments"
            onClick={() => setOpen(false)}
          >
            <Close />
          </Button>
        </header>
        <div className="comments-panel-body">
          {all.map((t) => (
            <div className="comments-panel-item" key={t.root.id}>
              <button
                type="button"
                className="comments-panel-anchor ui-mono"
                onClick={() => jumpTo(t.root.id)}
                title="Jump to this comment in the diff"
              >
                {t.root.filePath}:{t.root.startLine}
              </button>
              <Thread thread={t} />
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
