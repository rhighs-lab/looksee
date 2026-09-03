import open from 'open';
import type { RunCtx } from '@/cli/commands.js';
import { ensureServer, repoRootOf } from '@/cli/daemon.js';
import { format } from '@/cli/output.js';

export const runReview = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const root = await repoRootOf(positionals[0]);
  const base = typeof flags['base'] === 'string' ? flags['base'] : null;
  const running = await ensureServer(root, { base });
  if (!flags['no-open']) await open(running.url).catch(() => {});
  const pretty = flags['pretty'] === true;
  io.out(format(pretty ? running.url : { url: running.url }, pretty));
  return 0;
};
