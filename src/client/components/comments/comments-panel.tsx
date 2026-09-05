import { useEffect } from 'react';
import { Thread } from '@/client/components/comments/thread.js';
import { ArrowLeft, Close, CommentIcon } from '@/client/components/icons.js';
import { fileAnchor, fileHref } from '@/client/lib/anchors.js';
import { lineHash } from '@/client/lib/line-anchor.js';
import { useComments } from '@/client/store/comments.js';
import { useReview } from '@/client/store/review.js';
import { Button, Counter } from '@/client/ui/index.js';
import type { DecoratedComment } from '@/shared/protocol.js';

const inDiff = (rootId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-root-id="${rootId}"]`);

export function CommentsPanelToggle() {
  const open = useReview((s) => s.commentsPanel);
  const setOpen = useReview((s) => s.setCommentsPanel);
  const total = useComments((s) => Object.keys(s.threads).length);
  const count = useComments(
    (s) =>
      Object.values(s.threads).filter((t) => t.root.status !== 'resolved')
        .length
  );
  if (!total) return null;
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

function Jump({ root }: { root: DecoratedComment }) {
  const setOpen = useReview((s) => s.setCommentsPanel);
  const scope = useReview((s) => s.scope);
  const line = root.startLine || null;
  const where = `${root.filePath}${line ? `:${line}` : ''}`;

  const go = () => {
    const el = inDiff(root.id);
    if (el) {
      setOpen(false);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const card = document.getElementById(fileAnchor(root.filePath));
    if (card) {
      setOpen(false);
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    location.href = `${fileHref(root.filePath, scope)}${
      line ? lineHash({ lo: line, hi: root.endLine || line }) : ''
    }`;
  };

  return (
    <button
      type="button"
      className="comments-panel-anchor ui-mono"
      onClick={go}
      title="Go to this comment"
    >
      <ArrowLeft width={12} height={12} />
      {where}
    </button>
  );
}

export function CommentsPanel() {
  const open = useReview((s) => s.commentsPanel);
  const setOpen = useReview((s) => s.setCommentsPanel);
  const threads = useComments((s) => s.threads);
  const pendingId = useComments((s) => s.pendingReview?.id ?? null);

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
  const drafts = all.filter((t) => t.root.reviewId === pendingId && pendingId);
  const posted = all.filter((t) => !drafts.includes(t));
  const openCount = posted.filter((t) => t.root.status !== 'resolved').length;

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
            {openCount} open · {posted.length - openCount} resolved
            {drafts.length ? ` · ${drafts.length} draft` : ''}
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
          {drafts.length > 0 && (
            <div className="comments-panel-group">
              Drafts in your unsubmitted review
            </div>
          )}
          {drafts.map((t) => (
            <div className="comments-panel-item" key={t.root.id}>
              <Jump root={t.root} />
              <Thread thread={t} />
            </div>
          ))}
          {drafts.length > 0 && posted.length > 0 && (
            <div className="comments-panel-group">Submitted</div>
          )}
          {posted.map((t) => (
            <div className="comments-panel-item" key={t.root.id}>
              <Jump root={t.root} />
              <Thread thread={t} />
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
