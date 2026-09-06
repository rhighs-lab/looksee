import { useEffect, useMemo, useState } from 'react';
import { api } from '@/client/api/client.js';
import { Avatar } from '@/client/components/comments/avatar.js';
import { FileCard } from '@/client/components/file-card.js';
import { ArrowLeft } from '@/client/components/icons.js';
import { KindIcon } from '@/client/components/layer-badges.js';
import { Loading } from '@/client/components/loading.js';
import {
  TreeDirNode,
  TreePane,
  useSubnavHeight,
} from '@/client/components/tree-pane.js';
import { fileAnchor } from '@/client/lib/anchors.js';
import { relativeTime } from '@/client/lib/format.js';
import { buildTree } from '@/client/lib/tree.js';
import { LinkButton, Notice } from '@/client/ui/index.js';
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

function Contributors({ people }: { people: CommitContributor[] }) {
  return (
    <span className="commit-people">
      {people.map((p) => (
        <span
          className="commit-person"
          key={p.email}
          title={`${p.name} <${p.email}>${p.role === 'co-author' ? ' · co-author' : ''}`}
        >
          {p.avatarUrl ? (
            <img
              className="avatar"
              src={`${p.avatarUrl}${p.avatarUrl.includes('?') ? '&' : '?'}s=40`}
              alt=""
              width={20}
              height={20}
              loading="lazy"
            />
          ) : (
            <Avatar author={p.name} agent={false} />
          )}
          <span>{p.name}</span>
        </span>
      ))}
    </span>
  );
}

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
          {data && (
            <div className="pr-meta-row">
              <Contributors people={data.contributors} />
              <span className="ui-muted">
                {relativeTime(data.commit.date)} · {data.files.length}{' '}
                {data.files.length === 1 ? 'file' : 'files'}
              </span>
            </div>
          )}
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
