import { type ReactNode, useCallback, useEffect, useMemo } from 'react';
import { CommentRow } from '@/client/components/comments/comment-rows.js';
import { Composer } from '@/client/components/comments/composer.js';
import { Thread } from '@/client/components/comments/thread.js';
import {
  clearRangeHighlight,
  highlightRange,
  useRangeSelection,
} from '@/client/components/comments/use-range-selection.js';
import type { LineSlots } from '@/client/components/diff/diff-table.js';
import { snapshotForRange } from '@/client/lib/snapshot.js';
import { useRevealHiddenLines } from '@/client/pages/use-reveal-hidden-lines.js';
import {
  type Thread as ThreadModel,
  useComments,
} from '@/client/store/comments.js';
import { useReview } from '@/client/store/review.js';
import type { CommentSide } from '@/shared/protocol.js';

export type SnapshotAt = (
  filePath: string,
  side: CommentSide,
  lo: number,
  hi: number
) => string[];

/** The review store holds the diffs a review page renders. */
const storeSnapshot: SnapshotAt = (filePath, side, lo, hi) => {
  const s = useReview.getState();
  return snapshotForRange(
    s.diffs[filePath],
    s.expansions[filePath],
    side === 'old' ? 'old' : 'new',
    lo,
    hi
  );
};

export interface CommentSlots {
  enabled: boolean;
  slotsFor: (filePath: string) => LineSlots;
  fileCommentsFor: (filePath: string) => ReactNode;
  onFileComment: (filePath: string) => void;
}

/**
 * Everything a page needs to hang comments off diff lines. Split out of the
 * review page so the file and commit views can comment on code the current
 * comparison does not cover.
 */
export function useCommentSlots(
  snapshotAt: SnapshotAt = storeSnapshot
): CommentSlots {
  const enabled = useComments((s) => s.enabled);
  const threads = useComments((s) => s.threads);
  const compose = useComments((s) => s.compose);
  const openCompose = useComments((s) => s.openCompose);
  const closeCompose = useComments((s) => s.closeCompose);
  const submitCompose = useComments((s) => s.submitCompose);
  const startReviewWith = useComments((s) => s.startReviewWith);
  const pending = useComments((s) => s.pendingReview !== null);
  const bind = useComments((s) => s.bind);
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
      openCompose({
        filePath,
        side,
        startLine: lo,
        endLine: hi,
        snapshot: snapshotAt(filePath, side, lo, hi),
      });
      highlightRange(filePath, side, lo, hi);
    },
    [openCompose, snapshotAt]
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

  const submit = useCallback(
    async (body: string) => {
      await submitCompose(body);
      clearRangeHighlight();
    },
    [submitCompose]
  );

  const submitLabel = pending ? 'Add to review' : 'Add single comment';
  const secondary = pending
    ? undefined
    : {
        label: 'Start a review',
        title: 'Hold this comment as a draft and keep reviewing',
        run: async (body: string) => {
          await startReviewWith(body);
          clearRangeHighlight();
        },
      };

  const slotsFor = useCallback(
    (filePath: string): LineSlots => {
      const list = threadsByFile.get(filePath) ?? [];
      const c =
        compose && compose.filePath === filePath && compose.side !== 'file'
          ? compose
          : null;
      return {
        commentable: enabled,
        onGutterClick: (side, line, shift) =>
          onGutterClick(filePath, side, line, shift),
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
                filePath={filePath}
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
                filePath={filePath}
                line={line}
                compose
              >
                <Composer
                  anchor={{
                    kind: 'line',
                    filePath,
                    side,
                    startLine: c.startLine,
                    endLine: c.endLine,
                    snapshot: c.snapshot,
                  }}
                  onSubmit={submit}
                  onCancel={cancel}
                  submitLabel={submitLabel}
                  secondary={secondary}
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
      secondary,
    ]
  );

  const fileCommentsFor = useCallback(
    (filePath: string): ReactNode => {
      const list = (threadsByFile.get(filePath) ?? []).filter(
        (t) => t.root.side === 'file'
      );
      const composing =
        compose && compose.filePath === filePath && compose.side === 'file';
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
                anchor={{ kind: 'file', filePath }}
                onSubmit={submit}
                onCancel={cancel}
                submitLabel={submitLabel}
                secondary={secondary}
              />
            </div>
          )}
        </>
      );
    },
    [threadsByFile, compose, submit, cancel, submitLabel, secondary]
  );

  const onFileComment = useCallback(
    (filePath: string) =>
      openCompose({
        filePath,
        side: 'file',
        startLine: 0,
        endLine: 0,
        snapshot: [],
      }),
    [openCompose]
  );

  return { enabled, slotsFor, fileCommentsFor, onFileComment };
}
