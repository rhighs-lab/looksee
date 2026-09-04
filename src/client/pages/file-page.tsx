import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '@/client/api/client.js';
import { CommentRow } from '@/client/components/comments/comment-rows.js';
import { Composer } from '@/client/components/comments/composer.js';
import { Thread } from '@/client/components/comments/thread.js';
import {
  clearRangeHighlight,
  highlightRange,
  useRangeSelection,
} from '@/client/components/comments/use-range-selection.js';
import {
  DiffTable,
  type LineSlots,
} from '@/client/components/diff/diff-table.js';
import { Header } from '@/client/components/header.js';
import { File } from '@/client/components/icons.js';
import {
  TreeCheck,
  TreeDirNode,
  TreePane,
  useSubnavHeight,
} from '@/client/components/tree-pane.js';
import { fileAnchor, fileHref } from '@/client/lib/anchors.js';
import { buildTree } from '@/client/lib/tree.js';
import { useComments } from '@/client/store/comments.js';
import { useReview } from '@/client/store/review.js';
import { Label, Notice, Toast } from '@/client/ui/index.js';
import type {
  CommentSide,
  DiffLine,
  FileDiff,
  FileViewResponse,
  Scope,
  TreeEntry,
} from '@/shared/protocol.js';
import { SCOPES } from '@/shared/protocol.js';

function decodePath(pathname: string): string {
  return pathname
    .replace(/^\/file\//, '')
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join('/');
}

function toDiff(view: FileViewResponse): FileDiff {
  const lines: DiffLine[] = view.lines.map((content, i) => {
    const html = view.html ? view.html[i] : undefined;
    return {
      type: 'context',
      oldNumber: null,
      newNumber: i + 1,
      content,
      ...(html !== undefined ? { html } : {}),
    };
  });
  return {
    path: view.path,
    oldPath: null,
    kind: 'modified',
    binary: view.binary,
    language: null,
    additions: 0,
    deletions: 0,
    hunks: lines.length
      ? [
          {
            header: '',
            sectionHeading: '',
            oldStart: 1,
            oldLines: lines.length,
            newStart: 1,
            newLines: lines.length,
            lines,
          },
        ]
      : [],
    newLineCount: lines.length,
    rev: view.rev,
    oldRev: view.rev,
    digest: 'file',
    truncated: false,
  };
}

export function FilePage({ pathname }: { pathname: string }) {
  useSubnavHeight();
  const filePath = decodePath(pathname);
  const params = new URLSearchParams(location.search);
  const scopeParam = params.get('scope');
  const scope: Scope = SCOPES.includes(scopeParam as Scope)
    ? (scopeParam as Scope)
    : 'cumulative';
  const state = useReview((s) => s.state);
  const [view, setView] = useState<FileViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threads = useComments((s) => s.threads);
  const enabled = useComments((s) => s.enabled);
  const compose = useComments((s) => s.compose);
  const openCompose = useComments((s) => s.openCompose);
  const closeCompose = useComments((s) => s.closeCompose);
  const submitCompose = useComments((s) => s.submitCompose);
  const bind = useComments((s) => s.bind);
  useEffect(() => bind(), [bind]);

  useEffect(() => {
    document.documentElement.dataset['commentsEnabled'] =
      enabled && view?.inDiff ? '1' : '0';
  }, [enabled, view?.inDiff]);

  const version = state?.version ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-fetches the file after every repository change
  useEffect(() => {
    let alive = true;
    api
      .file(filePath, scope)
      .then((v) => alive && setView(v))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [filePath, scope, version]);

  const diff = useMemo(() => (view ? toDiff(view) : null), [view]);
  const changed = useMemo(() => new Set(view?.changedLines ?? []), [view]);
  const commentable = Boolean(enabled && view?.inDiff);
  const fileThreads = useMemo(
    () =>
      Object.values(threads).filter(
        (t) => t.root.filePath === filePath && t.root.side !== 'file'
      ),
    [threads, filePath]
  );

  const openLine = useCallback(
    (side: CommentSide, a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const snapshot = view ? view.lines.slice(lo - 1, hi) : [''];
      openCompose({
        filePath,
        side,
        startLine: lo,
        endLine: hi,
        snapshot: snapshot.length ? snapshot : [''],
      });
      highlightRange(filePath, side, lo, hi);
    },
    [filePath, openCompose, view]
  );
  const { suppressNextClick } = useRangeSelection(
    useCallback((p) => openLine(p.side, p.a, p.b), [openLine]),
    commentable
  );
  const cancel = useCallback(() => {
    closeCompose();
    clearRangeHighlight();
  }, [closeCompose]);
  const submit = useCallback(
    async (body: string) => {
      await submitCompose(body);
      clearRangeHighlight();
    },
    [submitCompose]
  );

  const slots: LineSlots = useMemo(
    () => ({
      commentable,
      onGutterClick: (side, line, shift) => {
        if (suppressNextClick()) return;
        const cur = useComments.getState().compose;
        const anchor =
          shift && cur && cur.filePath === filePath && cur.side === side
            ? cur.startLine
            : line;
        openLine(side, anchor, line);
      },
      after: (side, line) => {
        const out: ReactNode[] = [];
        for (const t of fileThreads) {
          const r = t.root;
          if (r.side !== side || (r.endLine || r.startLine) !== line) continue;
          out.push(
            <CommentRow
              key={r.id}
              split={false}
              side={side}
              rootId={r.id}
              filePath={filePath}
              line={line}
            >
              <Thread thread={t} />
            </CommentRow>
          );
        }
        if (
          compose &&
          compose.filePath === filePath &&
          compose.side === side &&
          compose.endLine === line
        ) {
          out.push(
            <CommentRow
              key="compose"
              split={false}
              side={side}
              filePath={filePath}
              line={line}
              compose
            >
              <Composer
                anchor={{
                  kind: 'line',
                  filePath,
                  side,
                  startLine: compose.startLine,
                  endLine: compose.endLine,
                  snapshot: compose.snapshot,
                }}
                onSubmit={submit}
                onCancel={cancel}
              />
            </CommentRow>
          );
        }
        return out.length ? out : null;
      },
    }),
    [
      commentable,
      fileThreads,
      compose,
      filePath,
      openLine,
      suppressNextClick,
      submit,
      cancel,
    ]
  );

  const tree = useMemo(
    () => buildTree(view?.tree ?? [], (t) => t.path),
    [view]
  );
  const crumbs = filePath.split('/');
  const repoName = state?.repoRoot?.split('/').pop() ?? 'repo';
  const backHref = `/${scope !== 'cumulative' ? `?scope=${scope}` : ''}#${fileAnchor(filePath)}`;

  const renderFile = (entry: TreeEntry, name: string, depth: number) => (
    <a
      key={entry.path}
      className={`tree-row tree-file-row${entry.path === filePath ? ' is-active' : ''}`}
      href={fileHref(entry.path, scope)}
      style={{ paddingLeft: 8 + depth * 14 + 14 }}
      title={entry.path}
    >
      <File className="tree-file-icon" />
      <span className="tree-name">{name}</span>
      <TreeCheck />
    </a>
  );

  return (
    <>
      <Header
        filters={false}
        title={
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className="crumb crumb-repo">{repoName}</span>
            {crumbs.map((c, i) => (
              <span key={crumbs.slice(0, i + 1).join('/')}>
                <span className="crumb-sep"> / </span>
                <span
                  className={`crumb${i === crumbs.length - 1 ? ' crumb-file' : ''}`}
                >
                  {c}
                </span>
              </span>
            ))}
          </nav>
        }
        left={
          <a className="back-link" href={backHref}>
            ← Back to review
          </a>
        }
        right={
          view && (
            <span className="diff-summary">
              {view.binary
                ? 'Binary file'
                : `${view.lines.length} ${view.lines.length === 1 ? 'line' : 'lines'}`}
              {view.deleted && (
                <Label tone="danger">
                  Deleted in this diff, showing base version
                </Label>
              )}
              {view.plain && (
                <Label>
                  Syntax highlighting off over{' '}
                  {view.maxHighlight.toLocaleString('en-US')} lines
                </Label>
              )}
              {!view.inDiff && !view.deleted && !view.binary && (
                <Label>Not in this diff, read-only</Label>
              )}
            </span>
          )
        }
      />
      <div className="review-layout">
        <TreePane header="Repository">
          <TreeDirNode node={tree} depth={0} renderFile={renderFile} />
        </TreePane>
        <main className="diff-container">
          {error && <Notice tone="danger">{error}</Notice>}
          {!view && !error && <Notice tone="muted">Loading file</Notice>}
          {view && diff && (
            <div className="file file-view" data-path={filePath}>
              <div className="file-body">
                <div className="file-comments" />
                {view.binary ? (
                  <div className="file-notice-body">Binary file not shown.</div>
                ) : (
                  <BlobTable diff={diff} changed={changed} slots={slots} />
                )}
              </div>
            </div>
          )}
        </main>
      </div>
      <Toast />
    </>
  );
}

function BlobTable({
  diff,
  changed,
  slots,
}: {
  diff: FileDiff;
  changed: Set<number>;
  slots: LineSlots;
}) {
  const tinted = useMemo<FileDiff>(
    () => ({
      ...diff,
      hunks: diff.hunks.map((h) => ({
        ...h,
        lines: h.lines.map((l) =>
          changed.has(l.newNumber ?? -1)
            ? { ...l, type: 'add' as const, oldNumber: null }
            : l
        ),
      })),
      newLineCount: null,
    }),
    [diff, changed]
  );
  return (
    <div className="blob-view">
      <DiffTable
        diff={tinted}
        split={false}
        slots={slots}
        expansions={undefined}
        loading={new Set()}
        onExpand={() => {}}
      />
    </div>
  );
}
