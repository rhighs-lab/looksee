import { useEffect, useState } from 'react';
import { api } from '@/client/api/client.js';
import { FileCard } from '@/client/components/file-card.js';
import { ArrowLeft } from '@/client/components/icons.js';
import { Loading } from '@/client/components/loading.js';
import { useSubnavHeight } from '@/client/components/tree-pane.js';
import { relativeTime } from '@/client/lib/format.js';
import { Notice } from '@/client/ui/index.js';
import type { ChangedFile, CommitDetailResponse } from '@/shared/protocol.js';

const asChanged = (f: CommitDetailResponse['files'][number]): ChangedFile => ({
  path: f.path,
  oldPath: f.oldPath,
  kind: f.kind,
  layers: [],
  binary: f.binary,
  additions: f.additions,
  deletions: f.deletions,
  digest: f.digest,
  generated: false,
  large: f.truncated,
});

export function CommitPage({ sha }: { sha: string }) {
  useSubnavHeight();
  const [data, setData] = useState<CommitDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .commit(sha)
      .then((r) => alive && setData(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [sha]);

  return (
    <>
      <header className="pr-subnav">
        <div className="pr-subnav-inner">
          <div className="pr-title-row">
            <a className="back-link" href="/">
              <ArrowLeft width={14} height={14} /> Review
            </a>
            <h1 className="pr-title ui-mono">{sha.slice(0, 7)}</h1>
            {data && (
              <span className="commit-title">{data.commit.subject}</span>
            )}
          </div>
          {data && (
            <div className="pr-meta-row">
              <span className="ui-muted">
                {data.commit.author} · {relativeTime(data.commit.date)} ·{' '}
                {data.files.length} {data.files.length === 1 ? 'file' : 'files'}
              </span>
            </div>
          )}
        </div>
      </header>
      <div className="review-layout tree-hidden">
        <main className="diff-container">
          {error && <Notice tone="danger">{error}</Notice>}
          {!data && !error && <Loading label="Reading the commit…" />}
          {data?.body && <pre className="commit-body">{data.body}</pre>}
          {data?.files.map((f) => (
            <FileCard
              key={f.path}
              file={asChanged(f)}
              diff={f}
              pending={false}
              viewHref={`/file/${f.path}`}
            />
          ))}
        </main>
      </div>
    </>
  );
}
