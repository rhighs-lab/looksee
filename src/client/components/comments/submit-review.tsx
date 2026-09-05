import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useComments } from '@/client/store/comments.js';
import { Button, SegmentedControl } from '@/client/ui/index.js';
import type { Verdict } from '@/shared/protocol.js';

const VERDICTS: { value: Verdict; label: string; title: string }[] = [
  {
    value: 'comment',
    label: 'Comment',
    title: 'Submit general feedback without explicit approval',
  },
  {
    value: 'approve',
    label: 'Approve',
    title: 'Submit feedback and approve the changes',
  },
  {
    value: 'request_changes',
    label: 'Request changes',
    title: 'Submit feedback that must be addressed',
  },
];

export function SubmitReview({
  count,
  onClose,
}: {
  count: number;
  onClose: () => void;
}) {
  const submitReview = useComments((s) => s.submitReview);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [verdict, setVerdict] = useState<Verdict>('comment');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    ta.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await submitReview(verdict, body);
      onClose();
    } catch (e) {
      setErr(`Could not submit: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      return onClose();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="review-submit comment-compose"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="composer-header">
        Finish your review with {count} comment{count === 1 ? '' : 's'}
      </div>
      <SegmentedControl<Verdict>
        label="Verdict"
        value={verdict}
        onChange={setVerdict}
        items={VERDICTS}
      />
      <textarea
        ref={ta}
        className="comment-input"
        rows={3}
        placeholder="Leave a summary"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {err && <div className="comment-error">{err}</div>}
      <div className="comment-compose-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          Submit review
        </Button>
      </div>
    </form>
  );
}
