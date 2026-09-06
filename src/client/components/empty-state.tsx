import { CommitIcon, Search } from '@/client/components/icons.js';
import { useReview } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';
import type { Scope } from '@/shared/protocol.js';
import { LAYER_LABEL } from '@/shared/protocol.js';

export function Shell({
  icon,
  title,
  children,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-body">{children}</p>
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}

function Commits() {
  const commits = useReview((s) => s.commits);
  if (!commits.length) return null;
  const last = commits[0];
  return (
    <>
      <a className="ui-btn ui-btn-small" href={`/commit/${last?.sha}`}>
        Open the last commit
      </a>
      <span className="ui-muted empty-state-hint">
        {commits.length} {commits.length === 1 ? 'commit' : 'commits'} in this
        comparison
      </span>
    </>
  );
}

export function FilteredEmpty({ scope }: { scope: Scope }) {
  const setScope = useReview((s) => s.setScope);

  if (scope !== 'cumulative')
    return (
      <Shell
        icon={<Search width={22} height={22} />}
        title={`Nothing ${LAYER_LABEL[scope].toLowerCase()}`}
        actions={
          <Button small onClick={() => void setScope('cumulative')}>
            Show all changes
          </Button>
        }
      >
        This comparison has changes, but none of them are in the{' '}
        {LAYER_LABEL[scope].toLowerCase()} layer.
      </Shell>
    );

  return (
    <Shell
      icon={<CommitIcon width={22} height={22} />}
      title="No changes in this comparison"
      actions={<Commits />}
    >
      Widen the comparison with the picker at the top to look further back.
    </Shell>
  );
}

export function CleanEmpty({ base }: { base: string }) {
  return (
    <Shell
      icon={<CommitIcon width={22} height={22} />}
      title="Nothing to review"
      actions={<Commits />}
    >
      The working tree is clean and this branch matches <code>{base}</code>.
      Edits show up here the moment you save.
    </Shell>
  );
}

const GONE = /^(not found|no repo|bad path|invalid sha|bad params)$/i;

/**
 * A failed page, said in words. Server strings like "not found" are for the
 * API's callers, not for someone who opened a link that no longer resolves.
 */
export function PageError({
  error,
  what,
  back,
}: {
  error: string;
  what: string;
  back: { href: string; label: string };
}) {
  const gone = GONE.test(error.trim());
  return (
    <Shell
      icon={<Search width={22} height={22} />}
      title={gone ? `That ${what} is not here` : `Could not open this ${what}`}
      actions={
        <a className="ui-btn ui-btn-small" href={back.href}>
          {back.label}
        </a>
      }
    >
      {gone
        ? `It may have been renamed, deleted, or belong to a different branch.`
        : error}
    </Shell>
  );
}
