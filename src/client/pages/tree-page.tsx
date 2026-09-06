import { useEffect, useMemo, useState } from 'react';
import { api } from '@/client/api/client.js';
import { ArrowLeft, File as FileIcon } from '@/client/components/icons.js';
import { Loading } from '@/client/components/loading.js';
import {
  TreeDirNode,
  TreePane,
  useSubnavHeight,
} from '@/client/components/tree-pane.js';
import { buildTree } from '@/client/lib/tree.js';
import { LinkButton, Notice } from '@/client/ui/index.js';
import type { TreeAtCommitResponse } from '@/shared/protocol.js';

export function TreePage({ sha }: { sha: string }) {
  useSubnavHeight();
  const [data, setData] = useState<TreeAtCommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .treeAt(sha)
      .then((r) => alive && setData(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [sha]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = data?.paths ?? [];
    return q ? all.filter((p) => p.toLowerCase().includes(q)) : all;
  }, [data, filter]);
  const tree = useMemo(() => buildTree(shown, (p) => p), [shown]);

  const renderFile = (path: string, name: string, depth: number) => (
    <a
      key={path}
      className="tree-row tree-file-row"
      href={`/history/${path}`}
      style={{ paddingLeft: 8 + depth * 14 + 14 }}
      title={`${path} — history`}
    >
      <span className="kind-icon ui-status-neutral">
        <FileIcon width={14} height={14} />
      </span>
      <span className="tree-name">{name}</span>
    </a>
  );

  return (
    <>
      <header className="pr-subnav">
        <div className="pr-subnav-inner">
          <div className="pr-title-row">
            <LinkButton className="back-link" href={`/commit/${sha}`}>
              <ArrowLeft width={12} height={12} />
              Commit
            </LinkButton>
            <h1 className="pr-title">Files</h1>
            <span className="ui-muted ui-mono">at {sha.slice(0, 7)}</span>
          </div>
        </div>
      </header>
      <div className="review-layout">
        {(data?.paths.length ?? 0) > 0 && (
          <TreePane
            header={`${data?.paths.length} files`}
            search={{
              value: filter,
              onChange: setFilter,
              placeholder: 'Filter files',
            }}
          >
            {shown.length === 0 ? (
              <div className="tree-empty">No file matches “{filter}”</div>
            ) : (
              <TreeDirNode node={tree} depth={0} renderFile={renderFile} />
            )}
          </TreePane>
        )}
        <main className="diff-container">
          {error && <Notice tone="danger">{error}</Notice>}
          {!data && !error && <Loading label="Reading the tree…" />}
          {data && (
            <Notice>
              The repository as it stood at {data.short}. Pick a file to read
              its history.
            </Notice>
          )}
        </main>
      </div>
    </>
  );
}
