import { useEffect, useState } from 'react';
import { SubmitReview } from '@/client/components/comments/submit-review.js';
import { selectDraftCount, useComments } from '@/client/store/comments.js';
import { Button, Counter, Notice } from '@/client/ui/index.js';

export function ReviewBar() {
  const pending = useComments((s) => s.pendingReview);
  const drafts = useComments(selectDraftCount);
  const startReview = useComments((s) => s.startReview);
  const discardReview = useComments((s) => s.discardReview);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!pending) {
      setOpen(false);
      setConfirming(false);
    }
  }, [pending]);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(t);
  }, [confirming]);

  const discard = () => {
    if (drafts > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    void discardReview();
  };

  if (!pending)
    return (
      <Button
        small
        title="Hold comments as drafts until you submit them together"
        onClick={() => void startReview()}
      >
        Review
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
      {confirming ? (
        <span className="ui-confirm">
          <span>
            Discard {drafts} draft{drafts === 1 ? '' : 's'}?
          </span>
          <Button small variant="danger" onClick={discard}>
            Discard
          </Button>
          <Button small onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <Button small onClick={discard}>
          Discard
        </Button>
      )}
      {open && <SubmitReview count={drafts} onClose={() => setOpen(false)} />}
    </span>
  );
}
