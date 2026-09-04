import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LineSlots } from '@/client/components/diff/diff-table.js';
import { FileCard } from '@/client/components/file-card.js';
import {
  FileFinder,
  useFileFinderHotkey,
} from '@/client/components/file-finder.js';
import { Header } from '@/client/components/header.js';
import { KindIcon, LayerLetters } from '@/client/components/layer-badges.js';
import { Loading } from '@/client/components/loading.js';
import {
  TreeCheck,
  TreeDirNode,
  TreePane,
  useSubnavHeight,
} from '@/client/components/tree-pane.js';
import { fileAnchor, fileHref } from '@/client/lib/anchors.js';
import { buildTree } from '@/client/lib/tree.js';
import { selectVisibleFiles, useReview } from '@/client/store/review.js';
import { Notice, Toast } from '@/client/ui/index.js';
import type { ChangedFile } from '@/shared/protocol.js';

export interface ReviewPageProps {
  slotsFor?: ((file: ChangedFile) => LineSlots) | undefined;
  fileCommentsFor?: ((file: ChangedFile) => ReactNode) | undefined;
  onFileComment?: ((path: string) => void) | undefined;
  headerRight?: ReactNode;
  headerBelow?: ReactNode;
}

export function ReviewPage({
  slotsFor,
  fileCommentsFor,
  onFileComment,
  headerRight,
  headerBelow,
}: ReviewPageProps) {
  useSubnavHeight();
  const status = useReview((s) => s.status);
  const error = useReview((s) => s.error);
  const state = useReview((s) => s.state);
  const scope = useReview((s) => s.scope);
  const files = useReview(useShallow(selectVisibleFiles));
  const diffs = useReview((s) => s.diffs);
  const pendingPaths = useReview((s) => s.pendingPaths);
  const layerFilter = useReview((s) => s.layerFilter);
  const viewed = useReview((s) => s.viewed);
  const updated = useReview((s) => s.updated);
  const activePath = useReview((s) => s.activePath);
  const setActivePath = useReview((s) => s.setActivePath);
  const [filter, setFilter] = useState('');
  const [finder, setFinder] = useState(false);
  useFileFinderHotkey(useCallback(() => setFinder(true), []));
  const entries = useMemo(
    () => files.map((f) => ({ path: f.path, kind: f.kind })),
    [files]
  );
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  }, [files, filter]);
  const tree = useMemo(() => buildTree(shown, (f) => f.path), [shown]);
  const pending = useMemo(() => new Set(pendingPaths), [pendingPaths]);

  const renderFile = (file: ChangedFile, name: string, depth: number) => (
    <a
      key={file.path}
      className={`tree-row tree-file-row${activePath === file.path ? ' is-active' : ''}${viewed[file.path] !== undefined ? ' is-viewed' : ''}`}
      href={`#${fileAnchor(file.path)}`}
      style={{ paddingLeft: 8 + depth * 14 + 14 }}
      title={file.path}
      onClick={() => setActivePath(file.path)}
    >
      <KindIcon kind={file.kind} />
      <span className="tree-name">{name}</span>
      {updated[file.path] && (
        <span className="updated-dot" title="Changed since you last looked" />
      )}
      <LayerLetters file={file} />
      <span className="tree-counts ui-mono">
        <span className="tree-add">+{file.additions}</span>{' '}
        <span className="tree-del">−{file.deletions}</span>
      </span>
      <TreeCheck />
    </a>
  );

  return (
    <>
      <Header right={headerRight} below={headerBelow} />
      <div className="review-layout">
        {files.length > 0 && (
          <TreePane
            header="Files changed"
            search={{
              value: filter,
              onChange: setFilter,
              placeholder: 'Filter changed files',
            }}
          >
            {shown.length === 0 ? (
              <div className="tree-empty">No files match “{filter}”</div>
            ) : (
              <TreeDirNode node={tree} depth={0} renderFile={renderFile} />
            )}
          </TreePane>
        )}
        <main className="diff-container">
          {status === 'loading' && (
            <Loading
              label={state ? 'Rebuilding the diff…' : 'Reading the repository…'}
            />
          )}
          {error && (
            <Notice tone="danger">
              Could not read the repository: {error}
            </Notice>
          )}
          {state && !state.repoRoot && (
            <Notice>
              Not a git repository, showing a built-in sample. Launch{' '}
              <code>looksee</code> from inside a repo to review real changes.
            </Notice>
          )}
          {status === 'ready' &&
            state?.repoRoot &&
            state.files.length === 0 && (
              <Notice tone="muted">
                Nothing to review:{' '}
                <code>{state.refs?.head.branch ?? 'HEAD'}</code> matches{' '}
                <code>{state.refs?.base.ref}</code> and the working tree is
                clean. Edits will appear here as they happen.
              </Notice>
            )}
          {status === 'ready' &&
            state &&
            state.files.length > 0 &&
            files.length === 0 && (
              <Notice tone="muted">
                {scope !== 'cumulative'
                  ? `Nothing in the ${scope} layer.`
                  : layerFilter.length
                    ? `No files match the selected layer filter (${layerFilter.join(', ')}).`
                    : 'No changes in this comparison.'}
              </Notice>
            )}
          {status !== 'loading' &&
            files.map((file) => (
              <FileCard
                key={file.path}
                file={file}
                diff={diffs[file.path]}
                pending={pending.has(file.path)}
                slots={slotsFor?.(file)}
                fileComments={fileCommentsFor?.(file)}
                onFileComment={onFileComment}
                viewHref={fileHref(file.path, scope)}
              />
            ))}
        </main>
      </div>
      {finder && (
        <FileFinder
          entries={entries}
          scope={scope}
          onClose={() => setFinder(false)}
        />
      )}
      <Toast />
    </>
  );
}
