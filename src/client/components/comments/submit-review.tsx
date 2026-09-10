import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Close } from '@/client/components/icons.js';
import { useComments } from '@/client/store/comments.js';
import { useReview } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';
import type { Verdict } from '@/shared/protocol.js';

const VERDICTS: { value: Verdict; label: string; hint: string }[] = [
  {
    value: 'comment',
    label: 'Comment',
    hint: 'Submit general feedback without explicit approval.',
  },
  {
    value: 'approve',
    label: 'Approve',
    hint: 'Submit feedback and approve these changes.',
  },
  {
    value: 'request_changes',
    label: 'Request changes',
    hint: 'Submit feedback that must be addressed.',
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
  const isRepo = useReview((s) => Boolean(s.state?.repoRoot));
  const ta = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLFormElement>(null);
  const name = useId();
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
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (root.current?.contains(t)) return;
      if (t.closest?.('[aria-expanded="true"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      ref={root}
      className="review-submit"
      aria-label="Finish your review"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="review-submit-head">
        <span>Finish your review</span>
        <Button
          variant="invisible"
          icon
          small
          type="button"
          title="Close"
          aria-label="Close"
          onClick={onClose}
        >
          <Close />
        </Button>
      </div>
      <div className="review-submit-body">
        <textarea
          ref={ta}
          className="comment-input"
          rows={4}
          placeholder="Leave a comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="review-verdicts" role="radiogroup" aria-label="Verdict">
          {VERDICTS.map((v) => {
            const disabled = v.value !== 'comment' && !isRepo;
            return (
              <label
                key={v.value}
                className={`review-verdict${disabled ? ' is-disabled' : ''}`}
              >
                <input
                  type="radio"
                  name={name}
                  value={v.value}
                  checked={verdict === v.value}
                  disabled={disabled}
                  onChange={() => setVerdict(v.value)}
                />
                <span className="review-verdict-text">
                  <span>{v.label}</span>
                  <span className="ui-muted">{v.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {err && <div className="comment-error">{err}</div>}
      </div>
      <div className="review-submit-foot">
        <span className="ui-muted">
          {count} pending comment{count === 1 ? '' : 's'}
        </span>
        <Button small type="submit" variant="primary" disabled={busy}>
          Submit review
        </Button>
      </div>
    </form>
  );
}
