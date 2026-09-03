import type { RunCtx } from '@/cli/commands.js';
import { connect } from '@/cli/connect.js';
import { format } from '@/cli/output.js';
import type { DecoratedComment } from '@/shared/protocol.js';

export const runResolve = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const id = positionals[0];
  if (!id) throw new Error('resolve needs a thread id');
  const { http } = await connect(flags, io.env);
  const { comment } = await http.patch<{ comment: DecoratedComment }>(
    `/api/comments/${encodeURIComponent(id)}`,
    { status: 'resolved' }
  );
  io.out(format(comment, false));
  return 0;
};
