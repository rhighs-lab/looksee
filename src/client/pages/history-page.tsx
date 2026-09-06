import { useEffect, useState } from 'react';
import { api } from '@/client/api/client.js';
import { PageError } from '@/client/components/empty-state.js';
import { ArrowLeft, CommitIcon, Copy } from '@/client/components/icons.js';
import { Loading } from '@/client/components/loading.js';
import { People } from '@/client/components/people.js';
import { useSubnavHeight } from '@/client/components/tree-pane.js';
import { relativeTime } from '@/client/lib/format.js';
import { Button, LinkButton, Notice } from '@/client/ui/index.js';
import type { FileHistoryResponse } from '@/shared/protocol.js';

const dayOf = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export function HistoryPage({ pathname }: { pathname: string }) {
  useSubnavHeight();
  const filePath = decodeURIComponent(pathname.slice('/history/'.length));
  const [data, setData] = useState<FileHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .fileHistory(filePath)
      .then((r) => alive && setData(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [filePath]);

  const days = new Map<string, FileHistoryResponse['commits']>();
  for (const c of data?.commits ?? []) {
    const k = dayOf(c.date);
    days.set(k, [...(days.get(k) ?? []), c]);
  }

  return (
    <>
      <header className="pr-subnav">
        <div className="pr-subnav-inner">
          <div className="pr-title-row">
            <LinkButton className="back-link" href={`/file/${filePath}`}>
              <ArrowLeft width={12} height={12} />
              File
            </LinkButton>
            <h1 className="pr-title">Commits</h1>
            <span className="ui-muted ui-mono">{filePath}</span>
          </div>
        </div>
      </header>
      <div className="review-layout tree-hidden">
        <main className="diff-container">
          {error && (
            <PageError
              error={error}
              what="history"
              back={{ href: '/', label: 'Back to the review' }}
            />
          )}
          {!data && !error && <Loading label="Reading the history…" />}
          {data && !data.commits.length && (
            <Notice>No commits touch this file yet.</Notice>
          )}
          <div className="history-timeline">
            {[...days].map(([day, list]) => (
              <section className="history-day" key={day}>
                <div className="history-node">
                  <CommitIcon width={16} height={16} />
                </div>
                <h2 className="history-day-label">Commits on {day}</h2>
                <div className="history-group">
                  {list.map((c) => (
                    <article className="history-row" key={c.sha}>
                      <div className="history-main">
                        <a
                          className="history-subject"
                          href={`/commit/${c.sha}`}
                        >
                          {c.subject}
                        </a>
                        <span className="history-by">
                          <People people={c.contributors} />
                          <span className="ui-muted">
                            committed {relativeTime(c.date)}
                          </span>
                        </span>
                      </div>
                      <span className="history-sha ui-mono">
                        <a href={`/commit/${c.sha}`}>{c.short}</a>
                        <Button
                          variant="invisible"
                          icon
                          small
                          title="Copy the full sha"
                          aria-label="Copy the full sha"
                          onClick={() => {
                            void navigator.clipboard?.writeText(c.sha);
                          }}
                        >
                          <Copy />
                        </Button>
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </main>
      </div>
    </>
  );
}
