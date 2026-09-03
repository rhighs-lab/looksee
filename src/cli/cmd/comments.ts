import type { RunCtx } from '@/cli/commands.js';
import { connect } from '@/cli/connect.js';
import { type Expects, expectsFor } from '@/cli/expects.js';
import { format } from '@/cli/output.js';
import type {
  CommentStatus,
  DecoratedComment,
  Review,
} from '@/shared/protocol.js';

export interface Thread extends DecoratedComment {
  expects: Expects;
  replies: DecoratedComment[];
}

export const threadsOf = (
  all: DecoratedComment[],
  keep: (root: DecoratedComment) => boolean
): Thread[] =>
  all
    .filter((c) => !c.parentId && keep(c))
    .map((root) => ({
      ...root,
      expects: expectsFor(root),
      replies: all.filter((c) => c.parentId === root.id),
    }));

const str = (v: string | boolean | undefined): string | null =>
  typeof v === 'string' && v ? v : null;

export const runComments = async ({ flags, io }: RunCtx): Promise<number> => {
  const status = str(flags['status']) ?? 'open';
  if (status !== 'open' && status !== 'resolved')
    throw new Error('--status must be open or resolved');
  const file = str(flags['file']);
  const author = str(flags['author']);
  const { http, actor } = await connect(flags, io.env);
  const [{ comments }, { reviews }] = await Promise.all([
    http.get<{ comments: DecoratedComment[] }>('/api/comments'),
    http.get<{ reviews: Review[] }>(
      `/api/reviews?state=pending&author=${encodeURIComponent(actor)}`
    ),
  ]);
  const drafts = new Set(reviews.map((r) => r.id));
  const want: CommentStatus = status;
  const threads = threadsOf(
    comments,
    (c) =>
      c.status === want &&
      !(c.reviewId && drafts.has(c.reviewId)) &&
      (!file || c.filePath === file) &&
      (!author || c.author === author)
  );
  io.out(format(threads, flags['pretty'] === true));
  return 0;
};
