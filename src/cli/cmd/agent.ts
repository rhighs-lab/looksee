import type { CommandSpec, RunCtx } from '@/cli/commands.js';
import { fullGuide } from '@/cli/guide.js';

export const runAgent =
  (cmds: () => readonly CommandSpec[]) =>
  async ({ io }: RunCtx): Promise<number> => {
    io.out(fullGuide(cmds()));
    return 0;
  };
