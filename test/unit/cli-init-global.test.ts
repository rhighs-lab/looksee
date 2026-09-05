import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MARKER } from '@/cli/cmd/init.js';
import { type Io, run } from '@/cli/main.js';

type Out = {
  scope: string;
  files: { agent: string; file: string; added: boolean }[];
};

describe('looksee init (global)', () => {
  let home: string;
  let prev: string | undefined;

  const cli = async () => {
    const out: string[] = [];
    const io: Io = {
      out: (s) => void out.push(s),
      err: () => undefined,
      env: process.env,
      stdin: async () => '',
    };
    const code = await run(['init'], io);
    return { code, res: JSON.parse(out.join('')) as Out };
  };

  beforeEach(async () => {
    prev = process.env['HOME'];
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
    process.env['HOME'] = home;
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prev;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('writes only the agents whose home exists', async () => {
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    const { code, res } = await cli();
    expect(code).toBe(0);
    expect(res.scope).toBe('global');
    expect(res.files.map((f) => f.agent)).toEqual(['claude-code', 'codex']);
    expect(res.files.every((f) => f.added)).toBe(true);
    const md = await fs.readFile(
      path.join(home, '.claude', 'CLAUDE.md'),
      'utf8'
    );
    expect(md.split('\n')[0]).toBe(MARKER);
    expect(md).toContain('looksee review . --scope');
  });

  it('appends below existing content and never twice', async () => {
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    const file = path.join(home, '.codex', 'AGENTS.md');
    await fs.writeFile(file, '# Mine\n\nUse tabs.\n');
    await cli();
    const { res } = await cli();
    expect(res.files[0]?.added).toBe(false);
    const md = await fs.readFile(file, 'utf8');
    expect(md.startsWith('# Mine\n\nUse tabs.\n\n')).toBe(true);
    expect(md.split('\n').filter((l) => l.trim() === MARKER)).toHaveLength(1);
  });

  it('reports nothing when no agent home is present', async () => {
    const { code, res } = await cli();
    expect(code).toBe(0);
    expect(res.files).toEqual([]);
  });
});
