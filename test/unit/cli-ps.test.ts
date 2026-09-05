import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serversDir } from '@/cli/daemon.js';
import { type Io, run } from '@/cli/main.js';

type Row = { pid: number; port: number; url: string; repoRoot: string };

const deadPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ['-e', '']);
  await new Promise((r) => child.once('exit', r));
  return child.pid!;
};

const write = (dir: string, key: string, rec: unknown) =>
  fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(rec));

describe('looksee ps', () => {
  let home: string;
  let prev: string | undefined;

  const cli = async (argv: string[]) => {
    const out: string[] = [];
    const io: Io = {
      out: (s) => void out.push(s),
      err: () => undefined,
      env: process.env,
      stdin: async () => '',
    };
    const code = await run(argv, io);
    return { code, out: out.join('') };
  };

  beforeAll(async () => {
    prev = process.env['LOOKSEE_HOME'];
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-ps-'));
    process.env['LOOKSEE_HOME'] = home;
    const dir = serversDir();
    await fs.mkdir(dir, { recursive: true });
    await write(dir, 'live', {
      pid: process.pid,
      port: 4711,
      repoRoot: '/repo/live',
      startedAt: '2026-01-01T00:00:00.000Z',
      title: 'alive',
    });
    await write(dir, 'dead', {
      pid: await deadPid(),
      port: 4712,
      repoRoot: '/repo/dead',
      startedAt: '2026-01-01T00:00:00.000Z',
      title: null,
    });
    await fs.writeFile(path.join(dir, 'junk.log'), 'not json');
  });

  afterAll(async () => {
    if (prev === undefined) delete process.env['LOOKSEE_HOME'];
    else process.env['LOOKSEE_HOME'] = prev;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('lists only servers whose pid is still alive', async () => {
    const { code, out } = await cli(['ps']);
    expect(code).toBe(0);
    const rows = JSON.parse(out) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pid: process.pid,
      port: 4711,
      url: 'http://127.0.0.1:4711',
      repoRoot: '/repo/live',
    });
  });

  it('prints an empty list when nothing is running', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-ps-none-'));
    process.env['LOOKSEE_HOME'] = empty;
    const { code, out } = await cli(['ps']);
    process.env['LOOKSEE_HOME'] = home;
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual([]);
    await fs.rm(empty, { recursive: true, force: true });
  });
});
