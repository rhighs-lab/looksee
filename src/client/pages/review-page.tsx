import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { api } from '@/client/api/client.js';
import type { LineSlots } from '@/client/components/diff/diff-table.js';
import { CleanEmpty, FilteredEmpty } from '@/client/components/empty-state.js';
import { FileCard } from '@/client/components/file-card.js';
import {
  FileFinder,
  useFileFinderHotkey,
} from '@/client/components/file-finder.js';
import { Header } from '@/client/components/header.js';
import { CommentIcon } from '@/client/components/icons.js';
import { KindIcon, LayerLetters } from '@/client/components/layer-badges.js';
import { Loading } from '@/client/components/loading.js';
import {
  TreeCheck,
  TreeDirNode,
  TreePane,
  useSubnavHeight,
} from '@/client/components/tree-pane.js';
import { fileAnchor, fileHref } from '@/client/lib/anchors.js';
import { fuzzyIndex, fuzzySearch, segments } from '@/client/lib/fuzzy.js';
import { buildTree } from '@/client/lib/tree.js';
import {
  revealTreeRow,
  useActiveFileSpy,
} from '@/client/pages/use-active-file-spy.js';
import { selectVisibleFiles, useReview } from '@/client/store/review.js';
import { Notice, Toast } from '@/client/ui/index.js';
import type { ChangedFile, TreeEntry } from '@/shared/protocol.js';

export interface ReviewPageProps {
  slotsFor?: ((file: ChangedFile) => LineSlots) | undefined;
  fileCommentsFor?: ((file: ChangedFile) => ReactNode) | undefined;
  onFileComment?: ((path: string) => void) | undefined;
  commentCounts?: Record<string, number> | undefined;
  headerRight?: ReactNode;
  above?: ReactNode;
  aside?: ReactNode;
}

export function ReviewPage({
  slotsFor,
  fileCommentsFor,
  onFileComment,
  commentCounts,
  headerRight,
  above,
  aside,
}: ReviewPageProps) {
  useSubnavHeight();
  const status = useReview((s) => s.status);
  const error = useReview((s) => s.error);
  const state = useReview((s) => s.state);
  const scope = useReview((s) => s.scope);
  const files = useReview(useShallow(selectVisibleFiles));
  const diffs = useReview((s) => s.diffs);
  const pendingPaths = useReview((s) => s.pendingPaths);
  const viewed = useReview((s) => s.viewed);
  const updated = useReview((s) => s.updated);
  const activePath = useReview((s) => s.activePath);
  const setActivePath = useReview((s) => s.setActivePath);
  const headSha = useReview((s) => s.state?.refs?.head.sha ?? null);
  const [filter, setFilter] = useState('');
  const [finder, setFinder] = useState(false);
  const [repoTree, setRepoTree] = useState<TreeEntry[] | null>(null);
  useFileFinderHotkey(useCallback(() => setFinder(true), []));
  const entries = useMemo(
    () => files.map((f) => ({ path: f.path, kind: f.kind })),
    [files]
  );
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  useActiveFileSpy(paths);
  useEffect(() => {
    if (!finder || repoTree || !headSha) return;
    let alive = true;
    void api
      .treeAt(headSha)
      .then((r) => {
        if (alive)
          setRepoTree(
            r.paths.map((path) => ({ path, kind: 'unchanged' as const }))
          );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [finder, repoTree, headSha]);
  const index = useMemo(() => fuzzyIndex(files, (f) => f.path), [files]);
  const query = useDeferredValue(filter.trim());
  const { shown, hits, first } = useMemo(() => {
    if (!query) return { shown: files, hits: null, first: null };
    const found = fuzzySearch(index, query, Number.POSITIVE_INFINITY);
    const hits = new Map(found.map((m) => [m.item.path, m.hits]));
    return {
      shown: files.filter((f) => hits.has(f.path)),
      hits,
      first: found[0]?.item ?? null,
    };
  }, [files, index, query]);
  const tree = useMemo(() => buildTree(shown, (f) => f.path), [shown]);
  const pending = useMemo(() => new Set(pendingPaths), [pendingPaths]);

  const jumpTo = useCallback(
    (path: string): boolean => {
      const card = document.getElementById(fileAnchor(path));
      if (!card) return false;
      setActivePath(path);
      history.replaceState(null, '', `#${fileAnchor(path)}`);
      card.scrollIntoView({ block: 'start' });
      return true;
    },
    [setActivePath]
  );

  const renderName = (file: ChangedFile, name: string) => {
    const h = hits?.get(file.path);
    if (!h?.length) return name;
    const base = file.path.length - name.length;
    return segments(
      name,
      h.filter((i) => i >= base).map((i) => i - base)
    ).map((seg, k) => (
      <span
        key={`${k}:${seg.text}`}
        className={seg.hit ? 'tree-hit' : undefined}
      >
        {seg.text}
      </span>
    ));
  };

  const renderFile = (file: ChangedFile, name: string, depth: number) => {
    const n = commentCounts?.[file.path] ?? 0;
    const active = activePath === file.path;
    return (
      <a
        key={file.path}
        ref={active ? revealTreeRow : undefined}
        className={`tree-row tree-file-row${active ? ' is-active' : ''}${viewed[file.path] !== undefined ? ' is-viewed' : ''}`}
        href={`#${fileAnchor(file.path)}`}
        style={{ paddingLeft: 8 + depth * 14 + 14 }}
        title={file.path}
        onClick={() => setActivePath(file.path)}
      >
        <KindIcon kind={file.kind} />
        <span className="tree-name">{renderName(file, name)}</span>
        {updated[file.path] && (
          <span className="updated-dot" title="Changed since you last looked" />
        )}
        {n > 0 && (
          <span
            className="tree-comments"
            title={`${n} open comment${n === 1 ? '' : 's'}`}
          >
            <CommentIcon width={12} height={12} />
            {n}
          </span>
        )}
        <LayerLetters file={file} />
        <span className="tree-counts ui-mono">
          <span className="tree-add">+{file.additions}</span>{' '}
          <span className="tree-del">−{file.deletions}</span>
        </span>
        <TreeCheck />
      </a>
    );
  };

  return (
    <>
      <Header right={headerRight} />
      <div className="review-layout">
        {files.length > 0 && (
          <TreePane
            header="Files changed"
            search={{
              value: filter,
              onChange: setFilter,
              placeholder: 'Filter changed files',
              onSubmit: () => first && jumpTo(first.path),
            }}
          >
            {query && shown.length > 0 && (
              <div className="tree-match-count ui-muted">
                {shown.length} of {files.length} files
              </div>
            )}
            {shown.length === 0 ? (
              <div className="tree-empty">No files match “{filter}”</div>
            ) : (
              <TreeDirNode node={tree} depth={0} renderFile={renderFile} />
            )}
          </TreePane>
        )}
        <main className="diff-container">
          {above}
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
              <CleanEmpty base={state.refs?.base.ref ?? 'the base branch'} />
            )}
          {status === 'ready' &&
            state &&
            state.files.length > 0 &&
            files.length === 0 && <FilteredEmpty scope={scope} />}
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
        {aside}
      </div>
      {finder && (
        <FileFinder
          entries={entries}
          extra={repoTree ?? undefined}
          scope={scope}
          onClose={() => setFinder(false)}
          onPick={jumpTo}
        />
      )}
      <Toast />
    </>
  );
}
