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
import { EditorLink } from '@/client/components/editor-link.js';
import { PageError } from '@/client/components/empty-state.js';
import {
  FileFinder,
  useFileFinderHotkey,
} from '@/client/components/file-finder.js';
import { FileGlyph } from '@/client/components/file-glyph.js';
import { FileInfo } from '@/client/components/file-info.js';
import { FileSymbolsView } from '@/client/components/file-symbols.js';
import { ForgeLink } from '@/client/components/forge-link.js';
import { Header } from '@/client/components/header.js';
import {
  ArrowLeft,
  CodeSquare,
  Copy,
  Download,
  File,
  HistoryIcon,
  Search,
  WrapText,
} from '@/client/components/icons.js';
import { isImage, rawHref } from '@/client/components/image-blob.js';
import { Loading } from '@/client/components/loading.js';
import { MarkdownDoc } from '@/client/components/markdown-doc.js';
import { People } from '@/client/components/people.js';
import {
  TreeCheck,
  TreeDirNode,
  TreePane,
  useSubnavHeight,
} from '@/client/components/tree-pane.js';
import { fileAnchor, fileHref } from '@/client/lib/anchors.js';
import type { ArrivedLine } from '@/client/lib/arrivals.js';
import { bytes, plural, relativeTime } from '@/client/lib/format.js';
import {
  type LineRange,
  lineHash,
  paintLineRange,
  parseLineHash,
} from '@/client/lib/line-anchor.js';
import { buildTree } from '@/client/lib/tree.js';
import { useComments } from '@/client/store/comments.js';
import { useReview } from '@/client/store/review.js';
import {
  Button,
  Label,
  LinkButton,
  Notice,
  SegmentedControl,
  Toast,
} from '@/client/ui/index.js';

import type {
  CommentSide,
  DiffLine,
  FileDiff,
  FileHistoryResponse,
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

function LastCommit({ filePath }: { filePath: string }) {
  const [head, setHead] = useState<FileHistoryResponse['commits'][0] | null>(
    null
  );
  useEffect(() => {
    let alive = true;
    api
      .fileHistory(filePath)
      .then((r) => alive && setHead(r.commits[0] ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [filePath]);
  return (
    <div className="file-crumb">
      {head ? (
        <>
          <People people={head.contributors} />
          <span className="file-crumb-subject">{head.subject}</span>
          <a className="file-crumb-sha ui-mono" href={`/commit/${head.sha}`}>
            {head.short}
          </a>
          <span className="file-crumb-when ui-muted">
            {relativeTime(head.date)}
          </span>
        </>
      ) : (
        <span className="ui-muted">No commit history for this file yet</span>
      )}
      <LinkButton href={`/history/${filePath}`}>
        <HistoryIcon width={14} height={14} />
        History
      </LinkButton>
    </div>
  );
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
  const showToast = useReview((s) => s.showToast);
  const [view, setView] = useState<FileViewResponse | null>(null);
  const [symbolsOpen, setSymbolsOpen] = useState(true);
  const [symbolsHost, setSymbolsHost] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const arrived = useReview((s) => s.arrivals[filePath]);
  const [filter, setFilter] = useState('');
  const [finder, setFinder] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [rendered, setRendered] = useState(true);
  const openFinder = useCallback(() => setFinder(true), []);
  useFileFinderHotkey(openFinder);
  const threads = useComments((s) => s.threads);
  const enabled = useComments((s) => s.enabled);
  const compose = useComments((s) => s.compose);
  const openCompose = useComments((s) => s.openCompose);
  const closeCompose = useComments((s) => s.closeCompose);
  const submitCompose = useComments((s) => s.submitCompose);
  const pendingReview = useComments((s) => s.pendingReview !== null);
  const startReviewWith = useComments((s) => s.startReviewWith);
  const bind = useComments((s) => s.bind);
  useEffect(() => bind(), [bind]);

  useEffect(() => {
    document.documentElement.dataset['commentsEnabled'] =
      enabled && view ? '1' : '0';
  }, [enabled, view]);

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
  // any line of any file can be commented on, not only lines the current
  // comparison happens to touch
  const commentable = Boolean(enabled && view);
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

  const secondary = pendingReview
    ? undefined
    : {
        label: 'Start a review',
        title: 'Hold this comment as a draft and keep reviewing',
        run: async (body: string) => {
          await startReviewWith(body);
          clearRangeHighlight();
        },
      };

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
                submitLabel={
                  pendingReview ? 'Add to review' : 'Add single comment'
                }
                secondary={secondary}
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
      pendingReview,
      secondary,
    ]
  );

  const entries = view?.tree ?? [];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q
      ? entries.filter((e) => e.path.toLowerCase().includes(q))
      : entries;
  }, [entries, filter]);
  const tree = useMemo(() => buildTree(shown, (t) => t.path), [shown]);
  const [anchor, setAnchor] = useState<LineRange | null>(() =>
    parseLineHash(location.hash)
  );
  useEffect(() => {
    const sync = () => setAnchor(parseLineHash(location.hash));
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    if (!view) return;
    paintLineRange(anchor)?.scrollIntoView({ block: 'center' });
  }, [anchor, view]);

  const onBlobClick = useCallback(
    (e: React.MouseEvent) => {
      if (commentable) return;
      const cell = (e.target as Element).closest<HTMLElement>(
        '.blob-num[data-line-number]'
      );
      if (!cell) return;
      const n = Number(cell.dataset['lineNumber']);
      const next: LineRange =
        e.shiftKey && anchor
          ? { lo: Math.min(anchor.lo, n), hi: Math.max(anchor.lo, n) }
          : { lo: n, hi: n };
      history.replaceState(null, '', lineHash(next));
      setAnchor(next);
    },
    [anchor, commentable]
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
      <FileGlyph path={entry.path} className="tree-file-icon" />
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
          <LinkButton
            className="back-btn"
            href={backHref}
            title="Back to review"
          >
            <ArrowLeft width={14} height={14} />
            Review
          </LinkButton>
        }
        right={
          <Button
            small
            className="finder-btn"
            onClick={openFinder}
            title="Go to file (t)"
          >
            <Search width={14} height={14} />
            Go to file
            <kbd>t</kbd>
          </Button>
        }
      />
      <div className="review-layout file-review-layout">
        <TreePane
          header="Repository"
          search={{
            value: filter,
            onChange: setFilter,
            placeholder: 'Filter files',
          }}
        >
          {shown.length === 0 ? (
            <div className="tree-empty">No files match “{filter}”</div>
          ) : (
            <TreeDirNode node={tree} depth={0} renderFile={renderFile} />
          )}
        </TreePane>
        <main className="diff-container">
          {error && (
            <PageError
              error={error}
              what="file"
              back={{ href: '/', label: 'Back to the review' }}
            />
          )}
          {!view && !error && <Loading label="Opening the file…" />}
          {view && <LastCommit filePath={filePath} />}
          {view && diff && (
            <div className="file file-view" data-path={filePath}>
              <BlobToolbar
                view={view}
                scope={scope}
                wrap={wrap}
                onWrap={() => setWrap(!wrap)}
                symbolsOpen={symbolsOpen}
                onSymbols={() => setSymbolsOpen(!symbolsOpen)}
                onCopied={showToast}
                doc={Boolean(view.markdownHtml)}
                rendered={rendered}
                onRendered={() => setRendered(!rendered)}
              />
              <div className="file-body">
                <div className="file-comments" />
                {view.markdownHtml && rendered ? (
                  <MarkdownDoc html={view.markdownHtml} />
                ) : view.binary ? (
                  isImage(filePath) ? (
                    <div className="blob-image">
                      <img src={rawHref(filePath, scope)} alt={filePath} />
                    </div>
                  ) : (
                    <div className="file-notice-body">
                      Binary file not shown.
                    </div>
                  )
                ) : (
                  <FileSymbolsView
                    key={`${view.path}:${view.rev}`}
                    data={view.symbols}
                    lineHtml={view.html}
                    host={symbolsHost}
                    open={symbolsOpen}
                    onToggle={() => setSymbolsOpen(!symbolsOpen)}
                    path={view.path}
                    onJump={(line) => {
                      const next = { lo: line, hi: line };
                      history.replaceState(null, '', lineHash(next));
                      setAnchor(next);
                    }}
                  >
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: line numbers are permalinks, reachable through the URL hash */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated gutter click over the blob table */}
                    <div onClick={onBlobClick}>
                      <BlobTable
                        diff={diff}
                        changed={changed}
                        slots={slots}
                        wrap={wrap}
                        arrived={arrived}
                      />
                    </div>
                  </FileSymbolsView>
                )}
              </div>
            </div>
          )}
        </main>
        {symbolsOpen &&
          view &&
          !view.binary &&
          !(view.markdownHtml && rendered) && (
            <div className="file-symbols-pane" ref={setSymbolsHost} />
          )}
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

function BlobToolbar({
  view,
  scope,
  wrap,
  onWrap,
  onCopied,
  doc,
  rendered,
  onRendered,
  symbolsOpen,
  onSymbols,
}: {
  view: FileViewResponse;
  scope: Scope;
  wrap: boolean;
  onWrap: () => void;
  onCopied: (msg: string) => void;
  doc: boolean;
  rendered: boolean;
  onRendered: () => void;
  symbolsOpen: boolean;
  onSymbols: () => void;
}) {
  const text = view.lines.join('\n');
  const name = view.path.split('/').pop() ?? view.path;
  const copy = async (value: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onCopied(msg);
    } catch {
      onCopied('Could not copy');
    }
  };

  return (
    <div className="blob-toolbar">
      <span className="blob-meta">
        {view.binary ? (
          <span>Binary file</span>
        ) : (
          <>
            <span>{plural(view.lines.length, 'line')}</span>
            <span className="blob-meta-sep">·</span>
            <span>{bytes(new Blob([text]).size)}</span>
          </>
        )}
        {view.deleted && (
          <Label tone="danger">Deleted here, showing the base version</Label>
        )}
        {view.plain && (
          <Label>
            Highlighting off over {view.maxHighlight.toLocaleString('en-US')}{' '}
            lines
          </Label>
        )}
        {!view.inDiff && !view.deleted && !view.binary && (
          <Label>Not in this diff</Label>
        )}
      </span>
      <span className="blob-actions">
        {doc && (
          <SegmentedControl<'preview' | 'code'>
            label="How to show this document"
            value={rendered ? 'preview' : 'code'}
            onChange={onRendered}
            items={[
              { value: 'preview', label: 'Preview' },
              { value: 'code', label: 'Code' },
            ]}
          />
        )}
        <FileInfo path={view.path} />
        <EditorLink filePath={view.path} />
        <ForgeLink filePath={view.path} />
        {!view.binary && (
          <Button
            small
            icon
            aria-pressed={wrap}
            title={wrap ? 'Do not wrap lines' : 'Wrap lines'}
            aria-label="Toggle line wrapping"
            onClick={onWrap}
          >
            <WrapText width={14} height={14} />
          </Button>
        )}
        <Button
          small
          icon
          title="Copy path"
          aria-label="Copy path"
          onClick={() => void copy(view.path, 'Path copied')}
        >
          <File width={14} height={14} />
        </Button>
        {!view.binary && (
          <Button
            small
            icon
            title="Copy raw file"
            aria-label="Copy raw file"
            onClick={() => void copy(text, 'File copied')}
          >
            <Copy width={14} height={14} />
          </Button>
        )}
        <a
          className="ui-btn ui-btn-small ui-btn-icon"
          href={rawHref(view.path, scope)}
          download={name}
          data-tooltip="Download raw file"
          aria-label="Download raw file"
        >
          <Download width={14} height={14} />
        </a>
        {!view.binary && !(doc && rendered) && (
          <Button
            small
            icon
            aria-label="Toggle symbols"
            title={symbolsOpen ? 'Hide symbols' : 'Show symbols'}
            aria-expanded={symbolsOpen}
            onClick={onSymbols}
          >
            <CodeSquare width={14} height={14} />
          </Button>
        )}
      </span>
    </div>
  );
}

function BlobTable({
  diff,
  changed,
  slots,
  wrap,
  arrived,
}: {
  diff: FileDiff;
  changed: Set<number>;
  slots: LineSlots;
  wrap: boolean;
  arrived: ArrivedLine[] | undefined;
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
    <div className={`blob-view${wrap ? ' is-wrapped' : ''}`}>
      <DiffTable
        diff={tinted}
        split={false}
        slots={slots}
        expansions={undefined}
        loading={new Set()}
        onExpand={() => {}}
        arrived={arrived}
      />
    </div>
  );
}
