import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { makeRepo, type Repo, seedRepo } from '@test/helpers/repo.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARKER } from '@/cli/cmd/init.js';
import {
  discover,
  ensureServer,
  findFreePort,
  type Running,
  recordPath,
  repoRootOf,
  stopServer,
} from '@/cli/daemon.js';
import { type Io, run } from '@/cli/main.js';
import { packageRoot } from '@/server/pkg-root.js';
import type { HealthResponse, RepoState } from '@/shared/protocol.js';

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

const scopeOf = async (url: string): Promise<string | undefined> =>
  ((await (await fetch(`${url}/api/state`)).json()) as RepoState).comparison
    ?.preset;

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

const until = async (f: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};

const up = (url: string): Promise<boolean> =>
  fetch(`${url}/healthz`)
    .then((r) => r.ok)
    .catch(() => false);

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
    await seedRepo(repo);
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

  it('review --scope sets the comparison on the running server', async () => {
    for (const preset of ['working', 'branch', 'session']) {
      const t = io();
      expect(
        await run(['review', repo.dir, '--no-open', '--scope', preset], t.io)
      ).toBe(0);
      expect(t.err.join('')).toBe('');
      expect(await scopeOf(first.url)).toBe(preset);
    }
    expect(await serversFor(root)).toBe(1);
  });

  it('review without --scope leaves the stored scope alone', async () => {
    const t = io();
    expect(
      await run(['review', repo.dir, '--no-open', '--scope', 'working'], t.io)
    ).toBe(0);
    expect(await run(['review', repo.dir, '--no-open'], t.io)).toBe(0);
    expect(await scopeOf(first.url)).toBe('working');
  });

  it('review --scope applies on a cold start, not just a reuse', async () => {
    const cold = await makeRepo();
    await seedRepo(cold);
    const coldRoot = await repoRootOf(cold.dir);
    try {
      const t = io();
      expect(
        await run(['review', cold.dir, '--no-open', '--scope', 'working'], t.io)
      ).toBe(0);
      const url = JSON.parse(t.out.join('')).url as string;
      expect(url).not.toBe(first.url);
      pids.add((await discover(coldRoot))!.pid);
      expect(await scopeOf(url)).toBe('working');
    } finally {
      await stopServer(coldRoot).catch(() => null);
      await cold.cleanup();
    }
  });

  it('serves an unborn-HEAD repo and warns instead of failing on scope', async () => {
    const bare = await makeRepo();
    const bareRoot = await repoRootOf(bare.dir);
    try {
      const t = io();
      expect(
        await run(['review', bare.dir, '--no-open', '--scope', 'working'], t.io)
      ).toBe(0);
      const url = JSON.parse(t.out.join('')).url as string;
      expect(t.err.join('')).toContain('could not set scope working');
      expect((await health(url)).ok).toBe(true);
      pids.add((await discover(bareRoot))!.pid);
    } finally {
      await stopServer(bareRoot).catch(() => null);
      await bare.cleanup();
    }
  });

  it('review --scope fails before spawning on a bad actor', async () => {
    const t = io();
    t.io.env = { ...process.env, LOOKSEE_ACTOR: 'user' };
    expect(
      await run(['review', other.dir, '--no-open', '--scope', 'working'], t.io)
    ).toBe(1);
    expect(t.err.join('')).toContain('reserved');
    expect(await discover(otherRoot)).toBeNull();
  });

  it('review --scope rejects an unknown preset without spawning', async () => {
    const t = io();
    expect(
      await run(['review', other.dir, '--no-open', '--scope', 'nope'], t.io)
    ).toBe(1);
    expect(t.err.join('')).toContain('session|working|branch');
    expect(await discover(otherRoot)).toBeNull();
  });

  it('review --scope custom points at the browser pickers', async () => {
    const t = io();
    expect(
      await run(['review', other.dir, '--no-open', '--scope', 'custom'], t.io)
    ).toBe(1);
    expect(t.err.join('')).toContain('browser pickers');
    expect(await discover(otherRoot)).toBeNull();
  });

  it('init creates AGENTS.md with the looksee block', async () => {
    process.chdir(other.dir);
    const t = io();
    expect(await run(['init', '--local'], t.io)).toBe(0);
    expect(JSON.parse(t.out.join(''))).toEqual({
      scope: 'local',
      files: [{ file: 'AGENTS.md', added: true }],
    });
    const md = await fs.readFile(path.join(otherRoot, 'AGENTS.md'), 'utf8');
    expect(md.split('\n')[0]).toBe(MARKER);
    expect(md).toContain('looksee review . --scope');
    expect(md).toContain('looksee agent');
    process.chdir(cwd);
  });

  it('init leaves a marker the block can be found by later', async () => {
    process.chdir(other.dir);
    const md = await fs.readFile(path.join(otherRoot, 'AGENTS.md'), 'utf8');
    expect(md.split('\n').filter((l) => l.trim() === MARKER)).toHaveLength(1);
    process.chdir(cwd);
  });

  it('init ignores a marker mentioned inside prose', async () => {
    const bare = await makeRepo();
    try {
      process.chdir(bare.dir);
      const file = path.join(await repoRootOf(bare.dir), 'AGENTS.md');
      await fs.writeFile(file, `We use the \`${MARKER}\` marker here.\n`);
      const t = io();
      expect(await run(['init', '--local'], t.io)).toBe(0);
      expect(JSON.parse(t.out.join('')).files[0].added).toBe(true);
      const md = await fs.readFile(file, 'utf8');
      expect(md.split('\n').filter((l) => l.trim() === MARKER)).toHaveLength(1);
    } finally {
      process.chdir(cwd);
      await bare.cleanup();
    }
  });

  it('init is a no-op the second time', async () => {
    process.chdir(other.dir);
    const file = path.join(otherRoot, 'AGENTS.md');
    const before = await fs.readFile(file, 'utf8');
    const t = io();
    expect(await run(['init', '--local'], t.io)).toBe(0);
    expect(JSON.parse(t.out.join(''))).toEqual({
      scope: 'local',
      files: [{ file: 'AGENTS.md', added: false }],
    });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    process.chdir(cwd);
  });

  it('init appends below existing AGENTS.md content', async () => {
    process.chdir(repo.dir);
    const file = path.join(root, 'AGENTS.md');
    await fs.writeFile(file, '# House rules\n\nUse tabs.\n');
    const t = io();
    expect(await run(['init', '--local'], t.io)).toBe(0);
    const md = await fs.readFile(file, 'utf8');
    expect(md.startsWith('# House rules\n\nUse tabs.\n\n')).toBe(true);
    expect(md.split('\n').filter((l) => l.trim() === MARKER)).toHaveLength(1);
    await fs.rm(file);
    process.chdir(cwd);
  });

  it('serve registers itself so ensureServer reuses it', async () => {
    const solo = await makeRepo();
    await seedRepo(solo);
    const soloRoot = await repoRootOf(solo.dir);
    const port = await findFreePort(4900);
    const child = spawn(
      process.execPath,
      [entry, 'serve', '--repo', soloRoot, '--port', String(port)],
      { env: { ...process.env, LOOKSEE_HOME: home }, stdio: 'ignore' }
    );
    pids.add(child.pid!);
    try {
      const url = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (await fetch(`${url}/healthz`).catch(() => null)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(await discover(soloRoot)).toEqual({
        port,
        pid: child.pid,
        url,
      });
      expect(await ensureServer(soloRoot)).toEqual({
        port,
        pid: child.pid,
        url,
      });
    } finally {
      child.kill('SIGKILL');
      await fs.rm(recordPath(soloRoot), { force: true });
      await solo.cleanup();
    }
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
      title: null,
      pendingReviews: 0,
      openThreads: 0,
      scope: null,
      openedAt: null,
      approvedAt: null,
      drift: false,
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

  it('reuses a live server whose healthz fails once', async () => {
    let hits = 0;
    const srv = http.createServer((req, res) => {
      hits++;
      if (hits === 1) return void req.socket.destroy();
      const h: HealthResponse = {
        ok: true,
        app: 'looksee',
        repoRoot: root,
        version: 1,
        pkgVersion: '0',
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(h));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as AddressInfo).port;
    await fs.writeFile(
      recordPath(root),
      JSON.stringify({ pid: process.pid, port, repoRoot: root })
    );
    expect(await discover(root)).toEqual({
      port,
      pid: process.pid,
      url: `http://127.0.0.1:${port}`,
    });
    expect(hits).toBe(2);
    expect(existsSync(recordPath(root))).toBe(true);
    await fs.rm(recordPath(root));
    await new Promise((r) => srv.close(r));
  });

  it('a manual serve on another port keeps the daemon record', async () => {
    const d = await ensureServer(root);
    pids.add(d.pid);
    const port = await findFreePort(d.port + 1);
    const child = spawn(
      process.execPath,
      [entry, 'serve', '--repo', root, '--port', String(port)],
      { env: process.env, stdio: 'ignore' }
    );
    pids.add(child.pid!);
    await until(() => up(`http://127.0.0.1:${port}`));
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill('SIGTERM');
    await exited;
    const rec = JSON.parse(await fs.readFile(recordPath(root), 'utf8')) as {
      pid: number;
    };
    expect(rec.pid).toBe(d.pid);
    expect(await discover(root)).toEqual(d);
    expect(await stopServer(root)).toBe(true);
  });
});
