import { type MouseEvent, memo, useState } from 'react';
import { Composer } from '@/client/components/comments/composer.js';
import {
  type Thread as ThreadModel,
  useComments,
} from '@/client/store/comments.js';
import { Button, Label } from '@/client/ui/index.js';
import type { DecoratedComment } from '@/shared/protocol.js';

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

function CommentCard({ c, isRoot }: { c: DecoratedComment; isRoot: boolean }) {
  const remove = useComments((s) => s.remove);
  const apply = useComments((s) => s.apply);
  const handoff = useComments((s) => s.handoff);
  const [error, setError] = useState('');
  const agent = c.author === 'claude';

  const onBodyClick = async (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('input[type="checkbox"]')) {
      e.preventDefault();
      return;
    }
    if (t.closest('.suggestion-apply')) {
      e.preventDefault();
      const btn = t.closest<HTMLButtonElement>('.suggestion-apply')!;
      btn.disabled = true;
      const r = await apply(c.id);
      if (!r.ok) {
        setError(r.message);
        btn.disabled = false;
      }
      return;
    }
    if (t.closest('.suggestion-handoff')) {
      e.preventDefault();
      try {
        await handoff(c.id);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  };

  return (
    <div
      className={`comment${agent ? ' comment-agent' : ''}`}
      data-comment-id={c.id}
      data-author={agent ? 'claude' : 'you'}
    >
      <div className="comment-header">
        <span className="comment-author">{agent ? 'agent' : 'you'}</span>
        <span className="ui-muted">commented {timeLabel(c.createdAt)}</span>
        {isRoot && c.side !== 'file' && c.endLine > c.startLine && (
          <span className="ui-muted">
            on lines {c.startLine}–{c.endLine}
          </span>
        )}
        <span className="comment-header-tools">
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated click for server-rendered buttons inside the body */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the inner buttons are real buttons and handle keyboard themselves */}
      <div
        className="comment-body markdown-body"
        onClick={(e) => void onBodyClick(e)}
        dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
      />
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
    </div>
  );
});
