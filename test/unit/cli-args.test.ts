import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveActor } from '@/cli/actor.js';
import { parseArgv } from '@/cli/args.js';
import { all, find, register } from '@/cli/commands.js';
import { client, HttpError } from '@/cli/http.js';
import { type Io, run } from '@/cli/main.js';
import { format } from '@/cli/output.js';

const io = (env: NodeJS.ProcessEnv = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const o: Io = {
    out: (s: string) => void out.push(s),
    err: (s: string) => void err.push(s),
    env,
    stdin: async () => '',
  };
  return { io: o, out, err };
};

afterEach(() => vi.unstubAllGlobals());

describe('parseArgv', () => {
  it('resolves a nested command with flags and positionals', () => {
    const p = parseArgv(
      ['review', 'comment', '--as', 'bot', 'src/a.ts:3-5', 'text'],
      all()
    );
    expect(p.cmd).toEqual(['review', 'comment']);
    expect(p.positionals).toEqual(['src/a.ts:3-5', 'text']);
    expect(p.flags).toEqual({ as: 'bot' });
  });

  it('accepts --flag=value, boolean flags, aliases and --', () => {
    const p = parseArgv(
      ['listen', '--as=bot', '--not-me', '-h', '--', '--x'],
      all()
    );
    expect(p.cmd).toEqual(['listen']);
    expect(p.flags).toEqual({ as: 'bot', 'not-me': true, help: true });
    expect(p.positionals).toEqual(['--x']);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgv(['status', '--nope'], all())).toThrow(/--nope/);
  });
});

describe('run', () => {
  it('prints command help for --help and exits 0', async () => {
    const t = io();
    expect(await run(['review', 'comment', '--help'], t.io)).toBe(0);
    const text = t.out.join('');
    expect(text).toContain('looksee review comment');
    expect(text).toContain(find(['review', 'comment'])!.summary);
    expect(text).toContain('--as');
    expect(t.err).toEqual([]);
  });

  it('lists every command in root help', async () => {
    const t = io();
    expect(await run(['--help'], t.io)).toBe(0);
    const text = t.out.join('');
    for (const c of all()) expect(text).toContain(c.name);
  });

  it('prints help to stderr and exits 1 on an unknown command', async () => {
    const t = io();
    expect(await run(['nope'], t.io)).toBe(1);
    expect(t.out).toEqual([]);
    expect(t.err.join('')).toContain('Usage');
  });

  it('prints one stderr line and no stdout on an http error', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'thread not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
    );
    register({
      name: 'boom',
      example: 'looksee boom',
      summary: 'test',
      args: '',
      flags: [],
      output: 'nothing',
      run: async () => {
        await client('http://127.0.0.1:1', 'agent').get('/api/comments/nope');
      },
    });
    const t = io();
    expect(await run(['boom'], t.io)).toBe(1);
    expect(t.out).toEqual([]);
    expect(t.err).toEqual(['thread not found\n']);
  });
});

describe('resolveActor', () => {
  it('resolves flag, then env, then agent', () => {
    expect(resolveActor({ as: 'bot' }, { LOOKSEE_ACTOR: 'env' })).toBe('bot');
    expect(resolveActor({}, { LOOKSEE_ACTOR: 'env' })).toBe('env');
    expect(resolveActor({}, {})).toBe('agent');
  });

  it('refuses user', () => {
    expect(() => resolveActor({ as: 'user' }, {})).toThrow(/user/);
    expect(() => resolveActor({}, { LOOKSEE_ACTOR: 'user' })).toThrow(/user/);
  });
});

describe('client', () => {
  it('sends actor and client headers and throws HttpError on non-2xx', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: 'bad' }), { status: 400 });
    });
    const c = client('http://h', 'bot');
    const err = await c.post('/api/x', { a: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).message).toBe('bad');
    const h = new Headers(calls[0]!.init.headers);
    expect(calls[0]!.url).toBe('http://h/api/x');
    expect(h.get('x-looksee-actor')).toBe('bot');
    expect(h.get('x-looksee-client')).toBe(`cli-${process.pid}`);
  });
});

describe('format', () => {
  const rows = [
    { id: 'a', path: 'src/a.ts', replies: [{ id: 'r' }] },
    { id: 'b', path: 'src/b.ts', replies: [] },
  ];

  it('prints valid JSON by default', () => {
    expect(JSON.parse(format(rows, false))).toEqual(rows);
  });

  it('prints one row per item with --pretty', () => {
    const lines = format(rows, true).trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/id\s+path\s+replies/);
    expect(lines[1]).toMatch(/^a\s+src\/a\.ts/);
    expect(lines[2]).toMatch(/^b\s+src\/b\.ts/);
  });
});
