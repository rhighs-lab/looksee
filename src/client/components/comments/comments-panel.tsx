import { type KeyboardEvent, type MouseEvent, useEffect } from 'react';
import { Thread as ThreadView } from '@/client/components/comments/thread.js';
import {
  ArrowLeft,
  Close,
  CommentIcon,
  Eye,
  EyeClosed,
} from '@/client/components/icons.js';
import { fileAnchor, fileHref } from '@/client/lib/anchors.js';
import { lineHash } from '@/client/lib/line-anchor.js';
import { lineMap } from '@/client/lib/snapshot.js';
import {
  awaitsUser,
  type Thread,
  useComments,
} from '@/client/store/comments.js';
import type { Expansions } from '@/client/store/review.js';
import { useReview } from '@/client/store/review.js';
import { Button, Counter } from '@/client/ui/index.js';
import type { DecoratedComment, FileDiff } from '@/shared/protocol.js';

const inDiff = (rootId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `.diff-container [data-root-id="${CSS.escape(rootId)}"]`
  );

const flash = (el: HTMLElement): void => {
  const thread = el.querySelector<HTMLElement>('.comment-thread') ?? el;
  thread.classList.remove('is-target');
  void thread.offsetWidth;
  thread.classList.add('is-target');
  thread.addEventListener(
    'animationend',
    () => thread.classList.remove('is-target'),
    { once: true }
  );
};

const INTERACTIVE = 'button, a, input, textarea, select, [contenteditable]';

const placed = (
  root: DecoratedComment,
  diffs: Record<string, FileDiff>,
  expansions: Record<string, Expansions>
): boolean => {
  const diff = diffs[root.filePath];
  if (!diff) return false;
  if (root.side === 'file') return true;
  const side = root.side === 'old' ? 'old' : 'new';
  return lineMap(diff, expansions[root.filePath], side).has(
    root.endLine || root.startLine
  );
};

export function CommentsVisibilityToggle() {
  const hidden = useReview((s) => s.commentsHidden);
  const setHidden = useReview((s) => s.setCommentsHidden);
  const total = useComments((s) => Object.keys(s.threads).length);
  useEffect(() => {
    document.documentElement.dataset['commentsHidden'] = hidden ? '1' : '0';
  }, [hidden]);
  if (!total) return null;
  const title = hidden ? 'Show review comments' : 'Hide review comments';
  return (
    <Button
      small
      icon
      variant="invisible"
      title={title}
      aria-label={title}
      aria-pressed={hidden}
      onClick={() => setHidden(!hidden)}
    >
      {hidden ? (
        <EyeClosed width={14} height={14} />
      ) : (
        <Eye width={14} height={14} />
      )}
    </Button>
  );
}

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

function useJump(root: DecoratedComment): () => void {
  const scope = useReview((s) => s.scope);
  const line = root.startLine || null;
  return () => {
    const el = inDiff(root.id);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      flash(el);
      return;
    }
    const card = document.getElementById(fileAnchor(root.filePath));
    if (card) {
      card.scrollIntoView({ block: 'start' });
      return;
    }
    location.href = `${fileHref(root.filePath, scope)}${
      line ? lineHash({ lo: line, hi: root.endLine || line }) : ''
    }`;
  };
}

function Jump({ root, go }: { root: DecoratedComment; go: () => void }) {
  const line = root.startLine || null;
  const where = `${root.filePath}${line ? `:${line}` : ''}`;
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

function PanelItem({ thread }: { thread: Thread }) {
  const go = useJump(thread.root);
  const shown = useReview((s) => placed(thread.root, s.diffs, s.expansions));
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest(INTERACTIVE)) return;
    go();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    go();
  };
  return (
    <div
      className="comments-panel-item"
      role="link"
      tabIndex={0}
      title="Go to this comment"
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <Jump root={thread.root} go={go} />
      {!shown && (
        <span className="comments-panel-note ui-muted">
          not in this diff, opens the file
        </span>
      )}
      <ThreadView thread={thread} expandResolved />
    </div>
  );
}

export function CommentsPanel() {
  const open = useReview((s) => s.commentsPanel);
  const setOpen = useReview((s) => s.setCommentsPanel);
  const threads = useComments((s) => s.threads);
  const pendingId = useComments((s) => s.pendingReview?.id ?? null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) =>
      e.key === 'Escape' && setOpen(false);
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
  const answered = posted.filter(awaitsUser).length;

  if (!open) return null;
  return (
    <aside className="comments-panel" aria-label="All comments">
      <header className="comments-panel-head">
        <span>
          Comments
          <span className="comments-panel-count">
            {openCount} open · {posted.length - openCount} resolved
            {answered ? ` (${answered} with an agent reply to read)` : ''}
            {drafts.length ? ` · ${drafts.length} draft` : ''}
          </span>
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
          <PanelItem key={t.root.id} thread={t} />
        ))}
        {drafts.length > 0 && posted.length > 0 && (
          <div className="comments-panel-group">Submitted</div>
        )}
        {posted.map((t) => (
          <PanelItem key={t.root.id} thread={t} />
        ))}
      </div>
    </aside>
  );
}
