import { readAnchor } from '@/cli/anchor.js';
import type { RunCtx } from '@/cli/commands.js';
import { type Conn, connect } from '@/cli/connect.js';
import { format } from '@/cli/output.js';
import type { DecoratedComment, RepoState } from '@/shared/protocol.js';

export const postAnchored = async (
  conn: Conn,
  anchor: string,
  body: string,
  reviewId: string | null
): Promise<DecoratedComment> => {
  const state = await conn.http.get<RepoState>('/api/state');
  if (!state.repoRoot) throw new Error('server has no repo');
  const at = await readAnchor(state.repoRoot, anchor);
  const { comment } = await conn.http.post<{ comment: DecoratedComment }>(
    '/api/comments',
    {
      ...at,
      body,
      branch: state.refs?.head.branch ?? null,
      parentId: null,
      reviewId,
    }
  );
  return comment;
};

export const anchorArgs = (positionals: string[]): [string, string] => {
  const [anchor, body] = positionals;
  if (!anchor || !body)
    throw new Error('expected <file>:<line>[-<line>] <body>');
  return [anchor, body];
};

export const runComment = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const [anchor, body] = anchorArgs(positionals);
  const conn = await connect(flags, io.env);
  io.out(format(await postAnchored(conn, anchor, body, null), false));
  return 0;
};
