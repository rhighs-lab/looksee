import { useEffect, useState } from 'react';
import { SubmitReview } from '@/client/components/comments/submit-review.js';
import {
  selectBanner,
  selectDraftCount,
  useComments,
} from '@/client/store/comments.js';
import { Button, Counter, Notice } from '@/client/ui/index.js';

export function ReviewBar() {
  const pending = useComments((s) => s.pendingReview);
  const drafts = useComments(selectDraftCount);
  const startReview = useComments((s) => s.startReview);
  const discardReview = useComments((s) => s.discardReview);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!pending) setOpen(false);
  }, [pending]);

  const discard = () => {
    if (
      drafts > 0 &&
      !confirm(
        `Discard this review and its ${drafts} draft comment${drafts === 1 ? '' : 's'}?`
      )
    )
      return;
    void discardReview();
  };

  if (!pending)
    return (
      <Button small onClick={() => void startReview()}>
        Start review
      </Button>
    );

  return (
    <span className="review-controls">
      <span className="ui-muted">Pending</span>
      <Counter n={drafts} />
      <Button
        small
        variant="primary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Submit review
      </Button>
      <Button small onClick={discard}>
        Discard
      </Button>
      {open && <SubmitReview count={drafts} onClose={() => setOpen(false)} />}
    </span>
  );
}

export function DoneBanner() {
  const banner = useComments(selectBanner);
  const dismissBanner = useComments((s) => s.dismissBanner);
  if (!banner) return null;
  return (
    <div className="review-banner">
      <Notice tone="attention">
        <span>
          {banner.actor} says: {banner.body || 'done'} - re-review when ready
        </span>
        <Button small onClick={dismissBanner}>
          Dismiss
        </Button>
      </Notice>
    </div>
  );
}
