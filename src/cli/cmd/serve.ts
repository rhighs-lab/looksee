import path from 'node:path';
import process from 'node:process';
import { serve } from '@hono/node-server';
import type { RunCtx } from '@/cli/commands.js';
import { findFreePort, releaseRecord, repoRootOf } from '@/cli/daemon.js';
import { createApp } from '@/server/app.js';
import { packageRoot } from '@/server/pkg-root.js';

const parsePort = (s: string): number => {
  const n = /^\d+$/.test(s) ? Number.parseInt(s, 10) : Number.NaN;
  if (!(n >= 1 && n <= 65535)) throw new Error(`invalid port: ${s}`);
  return n;
};

export const runServe = async ({ flags, io }: RunCtx): Promise<number> => {
  const port =
    typeof flags['port'] === 'string'
      ? parsePort(flags['port'])
      : await findFreePort(4711);
  const repoRoot = await repoRootOf(
    typeof flags['repo'] === 'string' ? flags['repo'] : undefined
  );
  const defaultBase = typeof flags['base'] === 'string' ? flags['base'] : null;
  const clientDir = path.join(packageRoot(import.meta.url), 'dist', 'client');
  const looksee = createApp({ repoRoot, defaultBase, clientDir });
  await looksee.start();
  serve({ fetch: looksee.app.fetch, hostname: '127.0.0.1', port }, () => {
    io.out(`looksee serving ${repoRoot} at http://127.0.0.1:${port}\n`);
  });
  const shutdown = (): void => {
    looksee.stop();
    releaseRecord(repoRoot, process.pid).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return 0;
};
