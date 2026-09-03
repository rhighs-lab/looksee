import type { RunCtx } from '@/cli/commands.js';
import { repoRootOf, stopServer } from '@/cli/daemon.js';
import { format } from '@/cli/output.js';

export const runStop = async ({ io }: RunCtx): Promise<number> => {
  const stopped = await stopServer(await repoRootOf());
  io.out(format({ stopped }, false));
  return 0;
};
