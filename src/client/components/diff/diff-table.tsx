import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { api } from '@/client/api/client.js';
import {
  buildRows,
  type Dir,
  type GapInfo,
  type Row,
  rangeFor,
} from '@/client/components/diff/rows.js';
import { ExpandAll, ExpandDown, ExpandUp } from '@/client/components/icons.js';
import {
  type ArrivedLine,
  markIndex,
  takeMark,
} from '@/client/lib/arrivals.js';
import { type Expansions, useReview } from '@/client/store/review.js';
import type { DiffLine, FileDiff, LineType } from '@/shared/protocol.js';

export type Side = 'old' | 'new';

export interface LineSlots {
  after?: (side: Side, line: number) => ReactNode;
  onGutterClick?: (side: Side, line: number, shift: boolean) => void;
  commentable?: boolean;
}

const MARKER: Record<LineType, string> = { context: ' ', add: '+', del: '-' };
const NUM_CLS: Record<LineType, string> = {
  context: 'blob-num-context',
  add: 'blob-num-addition',
  del: 'blob-num-deletion',
};
const CODE_CLS: Record<LineType, string> = {
  context: 'blob-code-context',
  add: 'blob-code-addition',
  del: 'blob-code-deletion',
};

const layerCls = (line: DiffLine, tint: boolean): string =>
  tint && line.layer && line.type !== 'context' ? ` layer-${line.layer}` : '';

const arrivedCls = (mark: number | undefined): string =>
  mark === undefined ? '' : ' line-arrived';

const hitCls = (line: DiffLine): string => (line.hit ? ' line-hit' : '');

function Code({
  line,
  tint,
  mark,
}: {
  line: DiffLine;
  tint: boolean;
  mark?: number | undefined;
}) {
  return (
    <td
      className={`blob-code ${CODE_CLS[line.type]}${layerCls(line, tint)}${arrivedCls(mark)}${hitCls(line)}`}
      data-arrival={mark}
    >
      <span className="blob-code-inner">
        <span className="marker">{MARKER[line.type]}</span>
        {line.html != null ? (
          <span dangerouslySetInnerHTML={{ __html: line.html }} />
        ) : (
          line.content
        )}
      </span>
    </td>
  );
}

function Num({
  n,
  line,
  side,
  slots,
  tint,
  mark,
}: {
  n: number | null;
  line: DiffLine;
  side: Side | null;
  slots: LineSlots;
  tint: boolean;
  mark?: number | undefined;
}) {
  const commentable = Boolean(slots.commentable && side && n != null);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the inner add-comment button is the keyboard path
    <td
      className={`blob-num ${NUM_CLS[line.type]}${layerCls(line, tint)}${commentable ? ' commentable' : ''}${arrivedCls(mark)}${hitCls(line)}`}
      data-arrival={mark}
      data-line-number={n ?? undefined}
      data-side={commentable ? side : undefined}
      data-comment-line={commentable ? n : undefined}
      onClick={
        commentable
          ? (e) => slots.onGutterClick?.(side!, n!, e.shiftKey)
          : undefined
      }
    >
      {commentable && (
        <button
          type="button"
          className="add-comment"
          tabIndex={-1}
          data-tooltip="Add a comment"
          aria-label="Add a comment"
        >
          +
        </button>
      )}
    </td>
  );
}

const Empty = () => (
  <>
    <td className="blob-num blob-num-empty" />
    <td className="blob-code blob-code-empty" />
  </>
);

function GapRow({
  gap,
  split,
  trailing,
  onExpand,
  loading,
}: {
  gap: GapInfo;
  split: boolean;
  trailing: boolean;
  onExpand: (dir: Dir) => void;
  loading: boolean;
}) {
  const icons: Record<Dir, ReactNode> = {
    up: <ExpandUp />,
    down: <ExpandDown />,
    all: <ExpandAll />,
  };
  const titles: Record<Dir, string> = {
    up: 'Expand up',
    down: 'Expand down',
    all: 'Expand all',
  };
  return (
    <tr
      className={`hunk-header-row${trailing ? ' boundary-trailing' : ''}`}
      data-expander
      data-gap-start-new={gap.start}
      data-gap-end-new={gap.end}
    >
      <td
        className={`blob-num blob-num-hunk blob-num-expand${gap.dirs.length === 2 ? ' blob-num-expand-2' : ''}`}
        colSpan={split ? 1 : 2}
      >
        {gap.dirs.map((d) => (
          <button
            key={d}
            type="button"
            className="expander"
            data-dir={d}
            data-tooltip={titles[d]}
            aria-label={`${titles[d]} (${gap.end - gap.start + 1} hidden lines)`}
            disabled={loading}
            onClick={() => onExpand(d)}
          >
            {icons[d]}
          </button>
        ))}
      </td>
      <td className="blob-code blob-code-hunk" colSpan={split ? 3 : undefined}>
        {gap.header}
      </td>
    </tr>
  );
}

function UnifiedLine({
  line,
  slots,
  tint,
  mark,
}: {
  line: DiffLine;
  slots: LineSlots;
  tint: boolean;
  mark?: number | undefined;
}) {
  const oldSide: Side | null = line.type === 'del' ? 'old' : null;
  const newSide: Side | null = line.type === 'del' ? null : 'new';
  return (
    <tr>
      <Num
        n={line.oldNumber}
        line={line}
        side={oldSide}
        slots={slots}
        tint={tint}
        mark={mark}
      />
      <Num
        n={line.newNumber}
        line={line}
        side={newSide}
        slots={slots}
        tint={tint}
        mark={mark}
      />
      <Code line={line} tint={tint} mark={mark} />
    </tr>
  );
}

function SplitPair({
  left,
  right,
  slots,
  tint,
  mark,
}: {
  left: DiffLine | null;
  right: DiffLine | null;
  slots: LineSlots;
  tint: boolean;
  mark?: number | undefined;
}) {
  return (
    <tr>
      {left ? (
        <>
          <Num
            n={left.oldNumber}
            line={left}
            side={left.type === 'del' ? 'old' : null}
            slots={slots}
            tint={tint}
          />
          <Code line={left} tint={tint} />
        </>
      ) : (
        <Empty />
      )}
      {right ? (
        <>
          <Num
            n={right.newNumber}
            line={right}
            side="new"
            slots={slots}
            tint={tint}
            mark={mark}
          />
          <Code line={right} tint={tint} mark={mark} />
        </>
      ) : (
        <Empty />
      )}
    </tr>
  );
}

export function useExpansion(diff: FileDiff) {
  const expansions = useReview((s) => s.expansions[diff.path]);
  const setExpansions = useReview((s) => s.setExpansions);
  const [loading, setLoading] = useState<Set<string>>(() => new Set());

  const expand = useCallback(
    async (gap: GapInfo, dir: Dir | 'mid', around?: number) => {
      const { from, to } = rangeFor(dir, gap.start, gap.end, around);
      const key = `${gap.boundary}:${from}`;
      setLoading((s) => new Set(s).add(key));
      try {
        const res = await api.context(diff.path, diff.rev, from, to);
        const lines: DiffLine[] = res.lines.map((content, i) => {
          const n = res.from + i;
          const html = res.html ? res.html[i] : undefined;
          return {
            type: 'context',
            oldNumber: n + gap.offset,
            newNumber: n,
            content,
            ...(html !== undefined ? { html } : {}),
          };
        });
        const cur: Expansions =
          useReview.getState().expansions[diff.path] ?? {};
        const segs = [...(cur[gap.boundary] ?? []), { from: res.from, lines }];
        setExpansions(diff.path, { ...cur, [gap.boundary]: segs });
      } catch {
        /* leave the expander so the user can retry */
      } finally {
        setLoading((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [diff.path, diff.rev, setExpansions]
  );

  const collapseAll = useCallback(
    () => setExpansions(diff.path, {}),
    [diff.path, setExpansions]
  );
  return { expansions, expand, collapseAll, loading };
}

export const DiffTable = memo(function DiffTable({
  diff,
  split,
  slots,
  expansions,
  loading,
  onExpand,
  arrived,
}: {
  diff: FileDiff;
  split: boolean;
  slots: LineSlots;
  expansions: Expansions | undefined;
  loading: Set<string>;
  onExpand: (gap: GapInfo, dir: Dir) => void;
  arrived?: ArrivedLine[] | undefined;
}) {
  const rows = useMemo(
    () => buildRows(diff, expansions, split),
    [diff, expansions, split]
  );
  // marks are stored as content, so they survive the renumbering that follows
  // an insertion; resolve them back to line objects once per render
  const marks = useMemo(() => {
    const found = new Map<DiffLine, number>();
    if (!arrived?.length) return found;
    const idx = markIndex(arrived);
    for (const hunk of diff.hunks)
      for (const line of hunk.lines) {
        if (line.type !== 'add') continue;
        const seq = takeMark(idx, line.content);
        if (seq !== undefined) found.set(line, seq);
      }
    return found;
  }, [diff, arrived]);
  const tint = useReview((s) => s.colorByLayer);
  const after = slots.after;
  const renderAfter = (row: Row): ReactNode => {
    if (!after) return null;
    if (row.kind === 'line') {
      const side: Side = row.line.type === 'del' ? 'old' : 'new';
      const n = side === 'old' ? row.line.oldNumber : row.line.newNumber;
      return n != null ? after(side, n) : null;
    }
    if (row.kind === 'pair') {
      const l =
        row.left && row.left.type === 'del' && row.left.oldNumber != null
          ? after('old', row.left.oldNumber)
          : null;
      const r =
        row.right && row.right.newNumber != null
          ? after('new', row.right.newNumber)
          : null;
      return (
        <>
          {l}
          {r}
        </>
      );
    }
    return null;
  };
  return (
    <table
      className={`diff-table ${split ? 'diff-table-split' : 'diff-table-unified'}`}
    >
      <colgroup>
        {split ? (
          <>
            <col className="col-num" />
            <col className="col-code" />
            <col className="col-num" />
            <col className="col-code" />
          </>
        ) : (
          <>
            <col className="col-num" />
            <col className="col-num" />
            <col className="col-code" />
          </>
        )}
      </colgroup>
      <tbody>
        {rows.map((row) => {
          if (row.kind === 'gap') {
            const busy = [...loading].some((k) =>
              k.startsWith(`${row.gap.boundary}:`)
            );
            return (
              <GapRow
                key={row.key}
                gap={row.gap}
                split={split}
                trailing={row.trailing}
                loading={busy}
                onExpand={(d) => onExpand(row.gap, d)}
              />
            );
          }
          if (row.kind === 'hunk') {
            return (
              <tr key={row.key} className="hunk-header-row">
                <td
                  className="blob-num blob-num-hunk blob-num-expand"
                  colSpan={split ? 1 : 2}
                />
                <td
                  className="blob-code blob-code-hunk"
                  colSpan={split ? 3 : undefined}
                >
                  {row.header}
                </td>
              </tr>
            );
          }
          const line =
            row.kind === 'line' ? (
              <UnifiedLine
                key={row.key}
                line={row.line}
                slots={slots}
                tint={tint}
                mark={marks.get(row.line)}
              />
            ) : (
              <SplitPair
                key={row.key}
                left={row.left}
                right={row.right}
                mark={row.right ? marks.get(row.right) : undefined}
                slots={slots}
                tint={tint}
              />
            );
          const extra = renderAfter(row);
          return extra ? (
            <Fragment key={row.key}>
              {line}
              {extra}
            </Fragment>
          ) : (
            line
          );
        })}
      </tbody>
    </table>
  );
});
