import { useEffect, useMemo, useState } from 'react';
import { api } from '@/client/api/client.js';
import { FileCard } from '@/client/components/file-card.js';
import {
  ArrowLeft,
  Copy,
  File as FileIcon,
} from '@/client/components/icons.js';
import { KindIcon } from '@/client/components/layer-badges.js';
import { Loading } from '@/client/components/loading.js';
import { People } from '@/client/components/people.js';
import {
  TreeDirNode,
  TreePane,
  useSubnavHeight,
} from '@/client/components/tree-pane.js';
import { fileAnchor } from '@/client/lib/anchors.js';
import { relativeTime } from '@/client/lib/format.js';
import { buildTree } from '@/client/lib/tree.js';
import { Button, LinkButton, Notice } from '@/client/ui/index.js';
import type {
  ChangedFile,
  CommitContributor,
  CommitDetailResponse,
} from '@/shared/protocol.js';

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

  const files = useMemo(() => data?.files ?? [], [data]);
  const tree = useMemo(() => buildTree(files, (f) => f.path), [files]);

  const renderFile = (
    f: CommitDetailResponse['files'][number],
    name: string,
    depth: number
  ) => (
    <a
      key={f.path}
      className="tree-row tree-file-row"
      href={`#${fileAnchor(f.path)}`}
      style={{ paddingLeft: 8 + depth * 14 + 14 }}
      title={f.path}
    >
      <KindIcon kind={f.kind} />
      <span className="tree-name">{name}</span>
      <span className="tree-counts ui-mono">
        <span className="tree-add">+{f.additions}</span>{' '}
        <span className="tree-del">−{f.deletions}</span>
      </span>
    </a>
  );

  return (
    <>
      <header className="pr-subnav">
        <div className="pr-subnav-inner">
          <div className="pr-title-row">
            <LinkButton className="back-link" href="/">
              <ArrowLeft width={12} height={12} />
              Review
            </LinkButton>
            <h1 className="pr-title ui-mono">{sha.slice(0, 7)}</h1>
            {data && (
              <span className="commit-title">{data.commit.subject}</span>
            )}
          </div>
        </div>
      </header>
      <div className="review-layout">
        {files.length > 0 && (
          <TreePane header="Files in this commit">
            <TreeDirNode node={tree} depth={0} renderFile={renderFile} />
          </TreePane>
        )}
        <main className="diff-container">
          {error && <Notice tone="danger">{error}</Notice>}
          {!data && !error && <Loading label="Reading the commit…" />}
          {data && (
            <section className="commit-detail">
              <h2 className="commit-detail-subject">{data.commit.subject}</h2>
              {data.body && <pre className="commit-body">{data.body}</pre>}
              <div className="commit-detail-nav">
                <span className="commit-steps">
                  <LinkButton
                    href={data.prev ? `/commit/${data.prev}` : '#'}
                    className={data.prev ? '' : 'is-disabled'}
                    aria-disabled={!data.prev}
                  >
                    <ArrowLeft width={12} height={12} />
                    Prev
                  </LinkButton>
                  <LinkButton
                    href={data.next ? `/commit/${data.next}` : '#'}
                    className={data.next ? '' : 'is-disabled'}
                    aria-disabled={!data.next}
                  >
                    Next
                  </LinkButton>
                </span>
                <LinkButton href={`/tree/${data.commit.sha}`}>
                  <FileIcon width={14} height={14} />
                  Browse files
                </LinkButton>
              </div>
              <footer className="commit-detail-foot">
                <People people={data.contributors} />
                <span className="ui-muted">
                  committed {relativeTime(data.commit.date)} ·{' '}
                  {data.files.length}{' '}
                  {data.files.length === 1 ? 'file' : 'files'}
                </span>
                <span className="commit-sha ui-mono">
                  commit {data.commit.short}
                  <Button
                    variant="invisible"
                    icon
                    small
                    title="Copy the full sha"
                    aria-label="Copy the full sha"
                    onClick={() => {
                      void navigator.clipboard?.writeText(data.commit.sha);
                    }}
                  >
                    <Copy />
                  </Button>
                </span>
              </footer>
            </section>
          )}
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
