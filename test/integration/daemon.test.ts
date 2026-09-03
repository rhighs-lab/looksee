import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { makeRepo, type Repo } from '@test/helpers/repo.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  discover,
  ensureServer,
  type Running,
  recordPath,
  repoRootOf,
  stopServer,
} from '@/cli/daemon.js';
import { type Io, run } from '@/cli/main.js';
import { packageRoot } from '@/server/pkg-root.js';
import type { HealthResponse } from '@/shared/protocol.js';

const exec = promisify(execFile);
const pkgRoot = packageRoot(import.meta.url);
const entry = path.join(pkgRoot, 'dist', 'server', 'cli', 'main.js');

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  const o: Io = {
    out: (s: string) => void out.push(s),
    err: (s: string) => void err.push(s),
    env: process.env,
  };
  return { io: o, out, err };
};

const health = async (url: string): Promise<HealthResponse> =>
  (await (await fetch(`${url}/healthz`)).json()) as HealthResponse;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const deadPid = (): Promise<number> =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', '']);
    p.once('exit', () => resolve(p.pid!));
  });

const serversFor = async (root: string): Promise<number> => {
  const { stdout } = await exec('pgrep', ['-f', `serve --repo ${root}`]).catch(
    () => ({ stdout: '' })
  );
  return stdout.split('\n').filter(Boolean).length;
};

describe('daemon lifecycle', () => {
  let home: string;
  let repo: Repo;
  let other: Repo;
  let root: string;
  let otherRoot: string;
  const cwd = process.cwd();
  const pids = new Set<number>();

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
    process.env['LOOKSEE_HOME'] = home;
    repo = await makeRepo();
    other = await makeRepo();
    root = await repoRootOf(repo.dir);
    otherRoot = await repoRootOf(other.dir);
    if (!existsSync(entry))
      await exec('pnpm', ['build:server'], { cwd: pkgRoot });
  });

  afterAll(async () => {
    await stopServer(root).catch(() => null);
    await stopServer(otherRoot).catch(() => null);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    process.chdir(cwd);
    await repo.cleanup();
    await other.cleanup();
    await fs.rm(home, { recursive: true, force: true });
  });

  let first: Running;

  it('spawns a server and writes the record', async () => {
    first = await ensureServer(root);
    pids.add(first.pid);
    expect(first.url).toBe(`http://127.0.0.1:${first.port}`);
    const rec = JSON.parse(await fs.readFile(recordPath(root), 'utf8')) as {
      pid: number;
      port: number;
      repoRoot: string;
    };
    expect(rec.pid).toBe(first.pid);
    expect(rec.port).toBe(first.port);
    const h = await health(first.url);
    expect(h.ok).toBe(true);
    expect(h.repoRoot).toBe(root);
    const pkg = JSON.parse(
      await fs.readFile(path.join(pkgRoot, 'package.json'), 'utf8')
    ) as { version: string };
    expect(h.pkgVersion).toBe(pkg.version);
  });

  it('reuses the running server on a second call', async () => {
    const again = await ensureServer(root);
    expect(again).toEqual(first);
    expect(await serversFor(root)).toBe(1);
  });

  it('review --no-open prints the url and does not spawn', async () => {
    const t = io();
    expect(await run(['review', repo.dir, '--no-open'], t.io)).toBe(0);
    expect(JSON.parse(t.out.join(''))).toEqual({ url: first.url });
    expect(await serversFor(root)).toBe(1);
  });

  it('treats a record for another repo root as stale', async () => {
    await fs.writeFile(
      recordPath(otherRoot),
      JSON.stringify({ ...first, repoRoot: otherRoot })
    );
    expect(await discover(otherRoot)).toBeNull();
    expect(existsSync(recordPath(otherRoot))).toBe(false);
    expect(await discover(root)).toEqual(first);
  });

  it('stops the server and removes the record', async () => {
    expect(await stopServer(root)).toBe(true);
    expect(alive(first.pid)).toBe(false);
    expect(existsSync(recordPath(root))).toBe(false);
    expect(await discover(root)).toBeNull();
    expect(await stopServer(root)).toBe(false);
  });

  it('status reports running: false without spawning', async () => {
    process.chdir(repo.dir);
    const t = io();
    expect(await run(['status'], t.io)).toBe(0);
    expect(JSON.parse(t.out.join(''))).toEqual({
      running: false,
      url: null,
      pid: null,
      pendingReviews: 0,
      openThreads: 0,
    });
    expect(existsSync(recordPath(root))).toBe(false);
    expect(await serversFor(root)).toBe(0);
  });

  it('replaces a record whose pid is dead', async () => {
    const pid = await deadPid();
    await fs.mkdir(path.dirname(recordPath(root)), { recursive: true });
    await fs.writeFile(
      recordPath(root),
      JSON.stringify({ pid, port: first.port, repoRoot: root })
    );
    const next = await ensureServer(root);
    pids.add(next.pid);
    expect(next.pid).not.toBe(pid);
    expect(alive(next.pid)).toBe(true);
    expect((await health(next.url)).ok).toBe(true);
    expect(await stopServer(root)).toBe(true);
  });

  it('two concurrent ensureServer calls share one server', async () => {
    const [a, b] = await Promise.all([ensureServer(root), ensureServer(root)]);
    pids.add(a.pid);
    pids.add(b.pid);
    expect(a).toEqual(b);
    expect(await serversFor(root)).toBe(1);
    const t = io();
    expect(await run(['status'], t.io)).toBe(0);
    expect(JSON.parse(t.out.join(''))).toMatchObject({
      running: true,
      url: a.url,
      pid: a.pid,
    });
    const s = io();
    expect(await run(['stop'], s.io)).toBe(0);
    expect(JSON.parse(s.out.join(''))).toEqual({ stopped: true });
    expect(alive(a.pid)).toBe(false);
  });
});
