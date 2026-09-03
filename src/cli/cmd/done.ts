import type { RunCtx } from '@/cli/commands.js';
import { connect } from '@/cli/connect.js';
import { format } from '@/cli/output.js';
import type { DoneMark } from '@/shared/protocol.js';

export const runDone = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const { http } = await connect(flags, io.env);
  const { done } = await http.post<{ done: DoneMark }>('/api/done', {
    body: positionals[0] ?? '',
  });
  io.out(format(done, false));
  return 0;
};
