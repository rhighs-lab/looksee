import { type ReactNode, useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CommentRow } from '@/client/components/comments/comment-rows.js';
import { Composer } from '@/client/components/comments/composer.js';
import {
  DoneBanner,
  ReviewBar,
} from '@/client/components/comments/review-bar.js';
import { Thread } from '@/client/components/comments/thread.js';
import {
  clearRangeHighlight,
  highlightRange,
  useRangeSelection,
} from '@/client/components/comments/use-range-selection.js';
import type { LineSlots } from '@/client/components/diff/diff-table.js';
import { snapshotForRange } from '@/client/lib/snapshot.js';
import { ReviewPage } from '@/client/pages/review-page.js';
import { useRevealHiddenLines } from '@/client/pages/use-reveal-hidden-lines.js';
import {
  canApply,
  type Thread as ThreadModel,
  useComments,
} from '@/client/store/comments.js';
import { useReview } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';
import type { ChangedFile, CommentSide } from '@/shared/protocol.js';

export function ReviewWithComments() {
  const enabled = useComments((s) => s.enabled);
  const threads = useComments((s) => s.threads);
  const compose = useComments((s) => s.compose);
  const openCompose = useComments((s) => s.openCompose);
  const closeCompose = useComments((s) => s.closeCompose);
  const submitCompose = useComments((s) => s.submitCompose);
  const bind = useComments((s) => s.bind);
  const pending = useComments((s) => s.pendingReview !== null);
  const split = useReview((s) => s.view === 'split');

  useEffect(() => bind(), [bind]);
  useEffect(() => {
    document.documentElement.dataset['commentsEnabled'] = enabled ? '1' : '0';
  }, [enabled]);

  const threadsByFile = useMemo(() => {
    const m = new Map<string, ThreadModel[]>();
    for (const t of Object.values(threads)) {
      const list = m.get(t.root.filePath) ?? [];
      list.push(t);
      m.set(t.root.filePath, list);
    }
    return m;
  }, [threads]);

  useRevealHiddenLines(threadsByFile);

  const openLine = useCallback(
    (filePath: string, side: CommentSide, a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const s = useReview.getState();
      const snapshot = snapshotForRange(
        s.diffs[filePath],
        s.expansions[filePath],
        side === 'old' ? 'old' : 'new',
        lo,
        hi
      );
      openCompose({ filePath, side, startLine: lo, endLine: hi, snapshot });
      highlightRange(filePath, side, lo, hi);
    },
    [openCompose]
  );

  const { suppressNextClick } = useRangeSelection(
    useCallback((p) => openLine(p.filePath, p.side, p.a, p.b), [openLine]),
    enabled
  );

  const onGutterClick = useCallback(
    (filePath: string, side: CommentSide, line: number, shift: boolean) => {
      if (suppressNextClick()) return;
      const cur = useComments.getState().compose;
      const anchor =
        shift && cur && cur.filePath === filePath && cur.side === side
          ? cur.startLine
          : line;
      openLine(filePath, side, anchor, line);
    },
    [openLine, suppressNextClick]
  );

  const cancel = useCallback(() => {
    closeCompose();
    clearRangeHighlight();
  }, [closeCompose]);

  const submitLabel = pending ? 'Add to review' : 'Add single comment';

  const submit = useCallback(
    async (body: string) => {
      await submitCompose(body);
      clearRangeHighlight();
    },
    [submitCompose]
  );

  const slotsFor = useCallback(
    (file: ChangedFile): LineSlots => {
      const list = threadsByFile.get(file.path) ?? [];
      const c =
        compose && compose.filePath === file.path && compose.side !== 'file'
          ? compose
          : null;
      return {
        commentable: enabled,
        onGutterClick: (side, line, shift) =>
          onGutterClick(file.path, side, line, shift),
        after: (side, line) => {
          const out: ReactNode[] = [];
          for (const t of list) {
            const r = t.root;
            if (r.side !== side || (r.endLine || r.startLine) !== line)
              continue;
            out.push(
              <CommentRow
                key={r.id}
                split={split}
                side={side}
                rootId={r.id}
                filePath={file.path}
                line={line}
              >
                <Thread thread={t} />
              </CommentRow>
            );
          }
          if (c && c.side === side && c.endLine === line) {
            out.push(
              <CommentRow
                key="compose"
                split={split}
                side={side}
                filePath={file.path}
                line={line}
                compose
              >
                <Composer
                  anchor={{
                    kind: 'line',
                    filePath: file.path,
                    side,
                    startLine: c.startLine,
                    endLine: c.endLine,
                    snapshot: c.snapshot,
                  }}
                  onSubmit={submit}
                  onCancel={cancel}
                  submitLabel={submitLabel}
                />
              </CommentRow>
            );
          }
          return out.length ? out : null;
        },
      };
    },
    [
      threadsByFile,
      compose,
      enabled,
      split,
      onGutterClick,
      submit,
      cancel,
      submitLabel,
    ]
  );

  const fileCommentsFor = useCallback(
    (file: ChangedFile): ReactNode => {
      const list = (threadsByFile.get(file.path) ?? []).filter(
        (t) => t.root.side === 'file'
      );
      const composing =
        compose && compose.filePath === file.path && compose.side === 'file';
      if (!list.length && !composing) return null;
      return (
        <>
          {list.map((t) => (
            <div
              key={t.root.id}
              className="file-comment"
              data-root-id={t.root.id}
            >
              <Thread thread={t} />
            </div>
          ))}
          {composing && (
            <div className="file-comment-compose">
              <Composer
                anchor={{ kind: 'file', filePath: file.path }}
                onSubmit={submit}
                onCancel={cancel}
                submitLabel={submitLabel}
              />
            </div>
          )}
        </>
      );
    },
    [threadsByFile, compose, submit, cancel, submitLabel]
  );

  const onFileComment = useCallback(
    (path: string) =>
      openCompose({
        filePath: path,
        side: 'file',
        startLine: 0,
        endLine: 0,
        snapshot: [],
      }),
    [openCompose]
  );

  return (
    <ReviewPage
      slotsFor={enabled ? slotsFor : undefined}
      fileCommentsFor={enabled ? fileCommentsFor : undefined}
      onFileComment={enabled ? onFileComment : undefined}
      headerRight={
        enabled ? (
          <>
            <ReviewActions />
            <ReviewBar />
          </>
        ) : null
      }
      headerBelow={enabled ? <DoneBanner /> : null}
    />
  );
}

function ReviewActions() {
  const { count, applyable } = useComments(
    useShallow((s) => {
      const roots = Object.values(s.threads).map((t) => t.root);
      return { count: roots.length, applyable: roots.filter(canApply).length };
    })
  );
  const applyAll = useComments((s) => s.applyAll);
  const exportAll = useComments((s) => s.exportAll);
  const clearAll = useComments((s) => s.clearAll);
  if (!count) return null;
  return (
    <>
      {applyable > 0 && (
        <Button small onClick={() => void applyAll()}>
          Apply {applyable} suggestion{applyable === 1 ? '' : 's'}
        </Button>
      )}
      <Button small variant="primary" onClick={() => void exportAll()}>
        Export {count} comment{count === 1 ? '' : 's'} for the agent
      </Button>
      <Button small onClick={() => void clearAll()}>
        Clear
      </Button>
    </>
  );
}
