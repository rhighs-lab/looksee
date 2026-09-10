import { Avatar } from '@/client/components/comments/avatar.js';
import { AuthorName } from '@/client/components/people.js';
import { relativeTime } from '@/client/lib/format.js';
import { selectDraftCount, useComments } from '@/client/store/comments.js';
import { StatusLetter, type Tone } from '@/client/ui/index.js';
import type { Review, Verdict } from '@/shared/protocol.js';

const VERDICT: Record<Verdict, { tone: Tone; letter: string; text: string }> = {
  approve: { tone: 'success', letter: 'A', text: 'approved these changes' },
  request_changes: {
    tone: 'danger',
    letter: 'R',
    text: 'requested changes',
  },
  comment: { tone: 'muted', letter: 'C', text: 'left review comments' },
};

const latestSubmitted = (reviews: Review[]): Review | null =>
  reviews
    .filter((r) => r.state === 'submitted' && r.submittedAt)
    .sort((a, b) => b.submittedAt!.localeCompare(a.submittedAt!))[0] ?? null;

export function ReviewBanner() {
  const latest = useComments((s) => latestSubmitted(s.reviews));
  const drafts = useComments(selectDraftCount);
  const pending = useComments((s) => s.pendingReview !== null);
  if (!latest && !pending) return null;
  const v = latest?.verdict ? VERDICT[latest.verdict] : VERDICT.comment;
  return (
    <section className="review-state" aria-label="Review state">
      {latest && (
        <div className={`review-state-row review-state-${v.tone}`}>
          <StatusLetter letter={v.letter} tone={v.tone} label={v.text} />
          <Avatar author={latest.author} />
          <span className="review-state-text">
            <AuthorName actor={latest.author} /> {v.text}
            <span className="ui-muted">
              {' '}
              · {relativeTime(latest.submittedAt)}
            </span>
          </span>
        </div>
      )}
      {latest?.body.trim() && (
        <div className="review-state-body">{latest.body}</div>
      )}
      {pending && (
        <div className="review-state-row review-state-pending">
          <StatusLetter letter="P" tone="attention" label="Pending review" />
          <span className="review-state-text">
            Your review is pending with {drafts} draft
            {drafts === 1 ? '' : 's'}, submit it to publish them
          </span>
        </div>
      )}
    </section>
  );
}
