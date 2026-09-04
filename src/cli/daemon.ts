import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { resolveRepoRoot } from '@/server/git/exec.js';
import { packageRoot } from '@/server/pkg-root.js';
import {
  lookseeHome,
  repoKey,
  writeJsonAtomic,
} from '@/server/review/store.js';
import type { HealthResponse } from '@/shared/protocol.js';

export interface ServerRecord {
  pid: number;
  port: number;
  repoRoot: string;
  startedAt: string;
  title?: string | null;
}

export interface Running {
  port: number;
  pid: number;
  url: string;
}

export interface SpawnOpts {
  base?: string | null;
  title?: string | null;
}

const FIRST_PORT = 4711;
const WAIT_MS = 5000;
const LOCK_TTL_MS = 5000;
const TICK_MS = 100;
const HEALTH_TRIES = 3;
const RETRY_MS = 200;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const serversDir = (): string => path.join(lookseeHome(), 'servers');

export const recordPath = (root: string): string =>
  path.join(serversDir(), `${repoKey(root)}.json`);

const logPath = (root: string): string =>
  path.join(serversDir(), `${repoKey(root)}.log`);

const lockPath = (root: string): string =>
  path.join(serversDir(), `${repoKey(root)}.lock`);

const urlOf = (port: number): string => `http://127.0.0.1:${port}`;

export const repoRootOf = async (p = process.cwd()): Promise<string> => {
  const root = await resolveRepoRoot(p);
  if (!root) throw new Error(`not a git repo: ${p}`);
  return root;
};

export const findFreePort = (start: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', () => findFreePort(start + 1).then(resolve, reject));
    srv.once('listening', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : start;
      srv.close(() => resolve(port));
    });
    srv.listen(start, '127.0.0.1');
  });

const readRecord = async (root: string): Promise<ServerRecord | null> => {
  try {
    return JSON.parse(
      await fs.readFile(recordPath(root), 'utf8')
    ) as ServerRecord;
  } catch {
    return null;
  }
};

const health = async (port: number): Promise<HealthResponse | null> => {
  try {
    const res = await fetch(`${urlOf(port)}/healthz`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
};

const sameRoot = async (a: string, b: string): Promise<boolean> => {
  try {
    return (await fs.realpath(a)) === (await fs.realpath(b));
  } catch {
    return false;
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const probe = async (rec: ServerRecord): Promise<HealthResponse | null> => {
  for (let i = 0; i < HEALTH_TRIES; i++) {
    const h = await health(rec.port);
    if (h) return h;
    if (!alive(rec.pid)) return null;
    await sleep(RETRY_MS * (i + 1));
  }
  return null;
};

export const discover = async (root: string): Promise<Running | null> => {
  const rec = await readRecord(root);
  if (!rec) return null;
  const h = alive(rec.pid) ? await probe(rec) : null;
  if (h?.ok && h.repoRoot && (await sameRoot(h.repoRoot, root)))
    return { port: rec.port, pid: rec.pid, url: urlOf(rec.port) };
  if (h || !alive(rec.pid)) await fs.rm(recordPath(root), { force: true });
  return null;
};

export const releaseRecord = async (
  root: string,
  pid: number
): Promise<void> => {
  const rec = await readRecord(root);
  if (rec?.pid === pid) await fs.rm(recordPath(root), { force: true });
};

const cliEntry = (): string => {
  const p = path.join(
    packageRoot(import.meta.url),
    'dist',
    'server',
    'cli',
    'main.js'
  );
  if (!existsSync(p))
    throw new Error(`looksee build not found at ${p}; run pnpm build`);
  return p;
};

const acquireLock = async (file: string): Promise<boolean> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const h = await fs.open(file, 'wx');
    await h.close();
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const st = await fs.stat(file).catch(() => null);
  if (!st || Date.now() - st.mtimeMs < LOCK_TTL_MS) return false;
  await fs.rm(file, { force: true });
  return acquireLock(file);
};

const waitForRecord = async (root: string): Promise<Running> => {
  const deadline = Date.now() + WAIT_MS + LOCK_TTL_MS;
  while (Date.now() < deadline) {
    const found = await discover(root);
    if (found) return found;
    if (!existsSync(lockPath(root))) return spawnServer(root);
    await sleep(TICK_MS);
  }
  throw new Error('timed out waiting for another looksee to start');
};

const launch = async (root: string, opts: SpawnOpts): Promise<Running> => {
  const entry = cliEntry();
  const port = await findFreePort(FIRST_PORT);
  const log = await fs.open(logPath(root), 'a');
  const args = [entry, 'serve', '--repo', root, '--port', String(port)];
  if (opts.base) args.push('--base', opts.base);
  if (opts.title) args.push('--title', opts.title);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    env: process.env,
  });
  child.unref();
  await log.close();
  const pid = child.pid!;
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `looksee server exited with ${child.exitCode}; see ${logPath(root)}`
      );
    const h = await health(port);
    if (h?.ok) {
      const rec: ServerRecord = {
        pid,
        port,
        repoRoot: root,
        startedAt: new Date().toISOString(),
        title: opts.title ?? null,
      };
      await writeJsonAtomic(recordPath(root), rec);
      return { port, pid, url: urlOf(port) };
    }
    await sleep(TICK_MS);
  }
  child.kill('SIGTERM');
  throw new Error(`looksee server did not answer; see ${logPath(root)}`);
};

export const spawnServer = async (
  root: string,
  opts: SpawnOpts = {}
): Promise<Running> => {
  const lock = lockPath(root);
  if (!(await acquireLock(lock))) return waitForRecord(root);
  try {
    return await launch(root, opts);
  } finally {
    await fs.rm(lock, { force: true });
  }
};

export const setTitle = async (
  url: string,
  title: string | null
): Promise<void> => {
  await fetch(`${url}/api/title`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  }).catch(() => undefined);
};

export const ensureServer = async (
  root: string,
  opts: SpawnOpts = {}
): Promise<Running> => {
  const found = await discover(root);
  if (!found) return spawnServer(root, opts);
  if (opts.title !== undefined && opts.title !== null) {
    await setTitle(found.url, opts.title);
    const rec = await readRecord(root);
    if (rec)
      await writeJsonAtomic(recordPath(root), { ...rec, title: opts.title });
  }
  return found;
};

const waitExit = async (pid: number): Promise<void> => {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (!alive(pid)) return;
    await sleep(TICK_MS);
  }
  throw new Error(`looksee server ${pid} did not stop`);
};

export const stopServer = async (root: string): Promise<boolean> => {
  const found = await discover(root);
  if (!found) return false;
  try {
    process.kill(found.pid, 'SIGTERM');
  } catch {
    await fs.rm(recordPath(root), { force: true });
    return false;
  }
  await waitExit(found.pid);
  await fs.rm(recordPath(root), { force: true });
  return true;
};
