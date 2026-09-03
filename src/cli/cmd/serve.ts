import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { serve } from '@hono/node-server';
import type { RunCtx } from '@/cli/commands.js';
import { findFreePort, recordPath, repoRootOf } from '@/cli/daemon.js';
import { createApp } from '@/server/app.js';
import { packageRoot } from '@/server/pkg-root.js';

export const runServe = async ({ flags, io }: RunCtx): Promise<number> => {
  const repoRoot = await repoRootOf(
    typeof flags['repo'] === 'string' ? flags['repo'] : undefined
  );
  const port =
    typeof flags['port'] === 'string'
      ? Number(flags['port'])
      : await findFreePort(4711);
  const defaultBase = typeof flags['base'] === 'string' ? flags['base'] : null;
  const clientDir = path.join(packageRoot(import.meta.url), 'dist', 'client');
  const looksee = createApp({ repoRoot, defaultBase, clientDir });
  await looksee.start();
  serve({ fetch: looksee.app.fetch, hostname: '127.0.0.1', port }, () => {
    io.out(`looksee serving ${repoRoot} at http://127.0.0.1:${port}\n`);
  });
  const shutdown = (): void => {
    looksee.stop();
    fs.rm(recordPath(repoRoot), { force: true }).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return 0;
};
