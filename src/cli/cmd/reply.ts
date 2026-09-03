import type { RunCtx } from '@/cli/commands.js';
import { connect } from '@/cli/connect.js';
import { format } from '@/cli/output.js';
import type { DecoratedComment } from '@/shared/protocol.js';

export const runReply = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const [id, arg] = positionals;
  if (!id) throw new Error('reply needs a thread id');
  const body = (arg ?? (await io.stdin())).trim();
  if (!body) throw new Error('reply needs a body (argument or stdin)');
  const { http } = await connect(flags, io.env);
  const { comment } = await http.post<{ comment: DecoratedComment }>(
    '/api/comments',
    { parentId: id, body }
  );
  io.out(format(comment, false));
  return 0;
};
