import fs from 'node:fs/promises';
import path from 'node:path';
import type { RunCtx } from '@/cli/commands.js';
import { alive, type ServerRecord, serversDir } from '@/cli/daemon.js';
import { format } from '@/cli/output.js';

export const runPs = async ({ flags, io }: RunCtx): Promise<number> => {
  const dir = serversDir();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const rows = [];
  for (const n of names.filter((n) => n.endsWith('.json'))) {
    const rec = await fs
      .readFile(path.join(dir, n), 'utf8')
      .then((t) => JSON.parse(t) as ServerRecord)
      .catch(() => null);
    if (!rec || !alive(rec.pid)) continue;
    rows.push({
      pid: rec.pid,
      port: rec.port,
      url: `http://127.0.0.1:${rec.port}`,
      repoRoot: rec.repoRoot,
      startedAt: rec.startedAt,
      title: rec.title ?? null,
    });
  }
  rows.sort((a, b) => a.repoRoot.localeCompare(b.repoRoot));
  io.out(format(rows, flags['pretty'] === true));
  return 0;
};
