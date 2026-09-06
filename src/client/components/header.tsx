import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ArrivalJump } from '@/client/components/arrival-jump.js';
import { CommitsMenu } from '@/client/components/commits-menu.js';
import { DiffStat } from '@/client/components/file-card.js';
import { Sidebar } from '@/client/components/icons.js';
import { ScopeSwitcher } from '@/client/components/scope-switcher.js';
import { SettingsMenu } from '@/client/components/settings-menu.js';
import { isStaleFetch, relativeTime } from '@/client/lib/format.js';
import { LAYER_GLYPH, LAYER_TONE, layerTitle } from '@/client/lib/layers.js';
import { useReview } from '@/client/store/review.js';
import {
  Button,
  Label,
  StatusLetter,
  UnderlineNav,
} from '@/client/ui/index.js';
import type { Scope } from '@/shared/protocol.js';
import { LAYER_LABEL, LAYERS } from '@/shared/protocol.js';

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Header({
  title,
  left,
  right,
  filters = true,
}: {
  title?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  filters?: boolean;
}) {
  const state = useReview((s) => s.state);
  const scope = useReview((s) => s.scope);
  const setScope = useReview((s) => s.setScope);
  const connection = useReview((s) => s.connection);
  const treeHidden = useReview((s) => s.treeHidden);
  const setTreeHidden = useReview((s) => s.setTreeHidden);
  const now = useNow();
  const refs = state?.refs ?? null;
  const isRepo = Boolean(state?.repoRoot);
  const summary = state?.summary;
  const comparison = state?.comparison ?? null;
  const stale = refs ? isStaleFetch(refs.lastFetchAt, now) : false;

  return (
    <header className="pr-subnav">
      <div className="pr-subnav-inner">
        <div className="pr-title-row">
          <Button
            variant="invisible"
            icon
            small
            title="Toggle file tree"
            aria-label="Toggle file tree"
            aria-pressed={!treeHidden}
            onClick={() => setTreeHidden(!treeHidden)}
          >
            <Sidebar />
          </Button>
          {left}
          <h1 className="pr-title">{title ?? 'Files changed'}</h1>
          {isRepo && refs && (
            <span className="pr-refs">
              <span className="ui-mono" title="Checked out branch">
                {refs.head.branch ?? refs.head.sha.slice(0, 7)}
              </span>
              {!refs.head.checkedOut && (
                <Label
                  tone="attention"
                  title="This branch is not checked out, so only its commits are shown; the working tree belongs to another branch"
                >
                  not checked out
                </Label>
              )}
              {refs.upstream ? (
                <span
                  className="ref-upstream ui-muted"
                  title={`Tracking ${refs.upstream.ref}`}
                >
                  {refs.upstream.ref}
                  <span className="ref-counts ui-mono">
                    <span
                      className="ui-status ui-status-success"
                      title={`${refs.upstream.ahead} commits ahead of ${refs.upstream.ref}`}
                    >
                      ↑{refs.upstream.ahead}
                    </span>
                    <span
                      className="ui-status ui-status-attention"
                      title={`${refs.upstream.behind} commits behind ${refs.upstream.ref}`}
                    >
                      ↓{refs.upstream.behind}
                    </span>
                  </span>
                </span>
              ) : (
                <span
                  className="ref-upstream ui-muted"
                  title="This branch tracks no remote branch"
                >
                  no upstream
                </span>
              )}
              <span
                className={`ref-fetch ${stale ? 'ui-attention' : 'ui-muted'}`}
                title={
                  refs.lastFetchAt
                    ? `Last git fetch: ${new Date(refs.lastFetchAt).toLocaleString()}. prequel never fetches.`
                    : 'No fetch recorded; remote state may be stale. prequel never fetches.'
                }
              >
                fetched {relativeTime(refs.lastFetchAt, now)}
              </span>
            </span>
          )}
          {!isRepo && refs && (
            <span className="pr-refs ui-muted">
              {refs.head.branch} into {refs.base.ref}
            </span>
          )}
          <span className="pr-title-right">
            {connection !== 'live' && connection !== 'off' && (
              <span className="pr-conn ui-attention" role="status">
                {connection === 'connecting' ? 'connecting…' : 'reconnecting…'}
              </span>
            )}
            {connection === 'off' && (
              <span className="pr-conn ui-muted" role="status">
                live updates off
              </span>
            )}
            {filters && isRepo && refs && <ScopeSwitcher />}
          </span>
        </div>
        <div className="pr-meta-row">
          {summary && (
            <span className="diff-summary">
              {comparison && (
                <span
                  className="summary-label"
                  title={`${comparison.baseline.short} to ${comparison.endpoint.short}`}
                >
                  {comparison.label}
                </span>
              )}
              <span>
                {summary.files} changed {summary.files === 1 ? 'file' : 'files'}
              </span>
              <span className="summary-additions">+{summary.additions}</span>
              <span className="summary-deletions">−{summary.deletions}</span>
              <DiffStat
                additions={summary.additions}
                deletions={summary.deletions}
              />
            </span>
          )}
          <span className="pr-meta-right">
            <CommitsMenu />
            {right}
            <ArrivalJump />
            <SettingsMenu />
            <span
              className="repo-path ui-muted ui-mono"
              title={state?.repoRoot ?? 'sample'}
            >
              {state?.repoLabel ?? state?.repoRoot ?? 'sample diff'}
            </span>
          </span>
        </div>
        {filters && isRepo && summary && (
          <div className="pr-layer-row">
            <UnderlineNav<Scope>
              label="Git layer to show"
              value={scope}
              onChange={(s) => void setScope(s)}
              items={[
                {
                  value: 'cumulative',
                  label: 'All changes',
                  count: summary.files,
                  title:
                    'Everything between the base branch and the working tree',
                },
                ...LAYERS.filter(
                  (l) => summary.byLayer[l] > 0 || scope === l
                ).map((l) => ({
                  value: l,
                  label: (
                    <>
                      <StatusLetter
                        letter={LAYER_GLYPH[l]}
                        tone={LAYER_TONE[l]}
                        label={LAYER_LABEL[l]}
                      />
                      {LAYER_LABEL[l]}
                    </>
                  ),
                  count: summary.byLayer[l],
                  title: layerTitle(l),
                })),
              ]}
            />
          </div>
        )}
      </div>
    </header>
  );
}
