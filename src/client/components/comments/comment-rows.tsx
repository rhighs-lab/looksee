import type { ReactNode } from 'react';
import type { CommentSide } from '@/shared/protocol.js';

export function ThreadCells({
  split,
  side,
  children,
}: {
  split: boolean;
  side: CommentSide;
  children: ReactNode;
}) {
  if (!split)
    return (
      <td className="comment-cell" colSpan={3}>
        {children}
      </td>
    );
  const cell = (
    <td className="comment-cell" colSpan={2}>
      {children}
    </td>
  );
  const empty = <td className="comment-cell-empty" colSpan={2} />;
  return side === 'old' ? (
    <>
      {cell}
      {empty}
    </>
  ) : (
    <>
      {empty}
      {cell}
    </>
  );
}

export function CommentRow({
  split,
  side,
  rootId,
  filePath,
  line,
  children,
  compose = false,
}: {
  split: boolean;
  side: CommentSide;
  rootId?: string;
  filePath: string;
  line: number;
  children: ReactNode;
  compose?: boolean;
}) {
  return (
    <tr
      className={`comment-row${compose ? ' comment-compose-row' : ''}`}
      data-root-id={rootId}
      data-file-path={filePath}
      data-side={side}
      data-line={line}
    >
      <ThreadCells split={split} side={side}>
        {children}
      </ThreadCells>
    </tr>
  );
}
