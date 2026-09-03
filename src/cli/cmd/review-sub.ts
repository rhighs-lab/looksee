import { anchorArgs, postAnchored } from '@/cli/cmd/comment.js';
import type { RunCtx } from '@/cli/commands.js';
import { type Conn, connect } from '@/cli/connect.js';
import { format } from '@/cli/output.js';
import {
  type DecoratedComment,
  type RepoState,
  type Review,
  VERDICTS,
  type Verdict,
} from '@/shared/protocol.js';

type ReviewRes = { review: Review; comments: DecoratedComment[] };

const pending = async (conn: Conn): Promise<Review> => {
  const { reviews } = await conn.http.get<{ reviews: Review[] }>(
    `/api/reviews?state=pending&author=${encodeURIComponent(conn.actor)}`
  );
  const rv = reviews[0];
  if (!rv) throw new Error('no pending review: run looksee review start first');
  return rv;
};

export const runReviewStart = async ({
  flags,
  io,
}: RunCtx): Promise<number> => {
  const conn = await connect(flags, io.env);
  const state = await conn.http.get<RepoState>('/api/state');
  const { review } = await conn.http.post<{ review: Review }>('/api/reviews', {
    branch: state.refs?.head.branch ?? null,
  });
  io.out(format(review, false));
  return 0;
};

export const runReviewComment = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const [anchor, body] = anchorArgs(positionals);
  const conn = await connect(flags, io.env);
  const rv = await pending(conn);
  io.out(format(await postAnchored(conn, anchor, body, rv.id), false));
  return 0;
};

export const runReviewSubmit = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const verdict = flags['verdict'];
  if (!VERDICTS.includes(verdict as Verdict))
    throw new Error(`--verdict must be one of ${VERDICTS.join(', ')}`);
  const conn = await connect(flags, io.env);
  const rv = await pending(conn);
  const res = await conn.http.post<ReviewRes>(`/api/reviews/${rv.id}/submit`, {
    verdict,
    body: positionals[0] ?? '',
  });
  io.out(format(res, false));
  return 0;
};

export const runReviewDiscard = async ({
  flags,
  io,
}: RunCtx): Promise<number> => {
  const conn = await connect(flags, io.env);
  const rv = await pending(conn);
  const res = await conn.http.del<{ ok: boolean }>(`/api/reviews/${rv.id}`);
  io.out(format(res, false));
  return 0;
};

export const runReviewShow = async ({ flags, io }: RunCtx): Promise<number> => {
  const conn = await connect(flags, io.env);
  const rv = await pending(conn);
  const res = await conn.http.get<ReviewRes>(`/api/reviews/${rv.id}`);
  io.out(format(res, flags['pretty'] === true));
  return 0;
};
