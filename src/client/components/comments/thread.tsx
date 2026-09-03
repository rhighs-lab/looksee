import { type KeyboardEvent, type MouseEvent, memo, useState } from 'react';
import { Composer } from '@/client/components/comments/composer.js';
import {
  isDraft,
  reviewOf,
  type Thread as ThreadModel,
  useComments,
} from '@/client/store/comments.js';
import { Button, Label, type Tone } from '@/client/ui/index.js';
import type { DecoratedComment, Verdict } from '@/shared/protocol.js';
import { USER_ACTOR } from '@/shared/protocol.js';

const VERDICT: Record<Verdict, { tone: Tone; text: string }> = {
  approve: { tone: 'success', text: 'Approved' },
  request_changes: { tone: 'danger', text: 'Changes requested' },
  comment: { tone: 'muted', text: 'Reviewed' },
};

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '';
  }
}

function DraftEditor({
  c,
  onClose,
}: {
  c: DecoratedComment;
  onClose: () => void;
}) {
  const editDraft = useComments((s) => s.editDraft);
  const [text, setText] = useState(c.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      await editDraft(c.id, text);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
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
      void save();
    }
  };

  return (
    <form
      className="comment-edit"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <textarea
        className="comment-input"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {err && <div className="comment-error">{err}</div>}
      <div className="comment-compose-actions">
        <Button small onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          small
          type="submit"
          variant="primary"
          disabled={busy || !text.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

function CommentCard({ c, isRoot }: { c: DecoratedComment; isRoot: boolean }) {
  const remove = useComments((s) => s.remove);
  const apply = useComments((s) => s.apply);
  const review = useComments((s) => reviewOf(s, c));
  const draft = useComments((s) => isDraft(s, c));
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const agent = c.author !== USER_ACTOR;
  const verdict = review?.verdict ? VERDICT[review.verdict] : null;

  const onBodyClick = async (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('input[type="checkbox"]')) {
      e.preventDefault();
      return;
    }
    if (!t.closest('.suggestion-apply')) return;
    e.preventDefault();
    const btn = t.closest<HTMLButtonElement>('.suggestion-apply')!;
    btn.disabled = true;
    const r = await apply(c.id);
    if (!r.ok) {
      setError(r.message);
      btn.disabled = false;
    }
  };

  return (
    <div
      className={`comment${agent ? ' comment-agent' : ''}${draft ? ' comment-draft' : ''}`}
      data-comment-id={c.id}
      data-author={c.author}
    >
      <div className="comment-header">
        <span className="comment-author">{c.author}</span>
        <span className="ui-muted">commented {timeLabel(c.createdAt)}</span>
        {isRoot && c.side !== 'file' && c.endLine > c.startLine && (
          <span className="ui-muted">
            on lines {c.startLine}-{c.endLine}
          </span>
        )}
        {draft && <Label tone="attention">Pending</Label>}
        {verdict && (
          <Label
            tone={verdict.tone}
            {...(review?.body ? { title: review.body } : {})}
          >
            {verdict.text}
          </Label>
        )}
        <span className="comment-header-tools">
          {draft && !editing && (
            <Button
              variant="invisible"
              small
              title="Edit draft"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )}
          <Button
            variant="invisible"
            small
            title="Delete comment"
            onClick={() => void remove(c.id)}
          >
            Delete
          </Button>
        </span>
      </div>
      {editing ? (
        <DraftEditor c={c} onClose={() => setEditing(false)} />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: delegated click for server-rendered buttons inside the body
        // biome-ignore lint/a11y/useKeyWithClickEvents: the inner buttons are real buttons and handle keyboard themselves
        <div
          className="comment-body markdown-body"
          onClick={(e) => void onBodyClick(e)}
          dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
        />
      )}
      {error && <div className="comment-error">{error}</div>}
    </div>
  );
}

export const Thread = memo(function Thread({
  thread,
}: {
  thread: ThreadModel;
}) {
  const { root, replies } = thread;
  const setStatus = useComments((s) => s.setStatus);
  const reply = useComments((s) => s.reply);
  const draft = useComments((s) => isDraft(s, root));
  const [replying, setReplying] = useState(false);
  const resolved = root.status === 'resolved';
  return (
    <div
      className={`comment-thread${resolved ? ' is-resolved' : ''}`}
      data-root-id={root.id}
    >
      <CommentCard c={root} isRoot />
      {replies.map((r) => (
        <CommentCard key={r.id} c={r} isRoot={false} />
      ))}
      {!draft && (
        <div className="comment-thread-footer">
          {replying ? (
            <div className="comment-reply-compose">
              <Composer
                anchor={{ kind: 'reply' }}
                onSubmit={async (body) => {
                  await reply(root.id, body);
                  setReplying(false);
                }}
                onCancel={() => setReplying(false)}
              />
            </div>
          ) : (
            <>
              <button
                type="button"
                className="comment-reply-field"
                onClick={() => setReplying(true)}
              >
                Reply
              </button>
              {resolved && <Label tone="done">Resolved</Label>}
              <Button
                small
                onClick={() =>
                  void setStatus(root.id, resolved ? 'open' : 'resolved')
                }
              >
                {resolved ? 'Unresolve conversation' : 'Resolve conversation'}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
});
