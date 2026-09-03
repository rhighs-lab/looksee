import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, type Repo } from '@test/helpers/repo.js';
import { startTestServer, type TestServer } from '@test/helpers/server.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DiffResponse, Layer } from '@/shared/protocol.js';

const changed = (
  res: DiffResponse,
  path: string
): { type: string; content: string; layer: Layer | undefined }[] =>
  res.files
    .find((f) => f.path === path)!
    .hunks.flatMap((h) => h.lines)
    .filter((l) => l.type !== 'context')
    .map((l) => ({ type: l.type, content: l.content, layer: l.layer }));

describe('GET /api/diff?attribute=1', () => {
  let repo: Repo;
  let srv: TestServer;
  let home: string;
  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
    process.env['LOOKSEE_HOME'] = home;
    repo = await makeRepo({ remote: true });
    await repo.write('a.txt', 'one\ntwo\nthree\nfour\n');
    await repo.commitAll('base');
    await repo.git(['push', '-q', '-u', 'origin', 'main']);
    await repo.git(['remote', 'set-head', 'origin', 'main']);
    await repo.git(['checkout', '-qb', 'other']);
    await repo.write('b.txt', 'other branch\n');
    await repo.commitAll('other');
    await repo.git(['checkout', '-qb', 'feature', 'main']);
    await repo.write('a.txt', 'one\ntwo\nthree\nfour\nfive\n');
    await repo.commitAll('local five');
    await repo.write('a.txt', 'one\ntwo staged\nthree\nfour\nfive\n');
    await repo.git(['add', 'a.txt']);
    await repo.write('a.txt', 'one\ntwo staged\nthree\nfour unstaged\nfive\n');
    await repo.write('new.txt', 'brand new\n');
    srv = await startTestServer({ repoRoot: repo.dir });
  });
  afterAll(async () => {
    await srv.close();
    await repo.cleanup();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('tags every add and del line with the layer that introduced it', async () => {
    const { body } = await srv.json<DiffResponse>(
      'GET',
      '/api/diff?attribute=1'
    );
    expect(changed(body, 'a.txt')).toEqual([
      { type: 'del', content: 'two', layer: 'staged' },
      { type: 'add', content: 'two staged', layer: 'staged' },
      { type: 'del', content: 'four', layer: 'unstaged' },
      { type: 'add', content: 'four unstaged', layer: 'unstaged' },
      { type: 'add', content: 'five', layer: 'local' },
    ]);
    expect(changed(body, 'new.txt')).toEqual([
      { type: 'add', content: 'brand new', layer: 'untracked' },
    ]);
  });

  it('respects path filtering and the full flag', async () => {
    const { body } = await srv.json<DiffResponse>(
      'GET',
      '/api/diff?attribute=1&path=new.txt&full=1'
    );
    expect(body.files.map((f) => f.path)).toEqual(['new.txt']);
    expect(changed(body, 'new.txt')[0]!.layer).toBe('untracked');
  });

  it('omits layer without the attribute flag', async () => {
    const { body } = await srv.json<DiffResponse>('GET', '/api/diff');
    const all = body.files.flatMap((f) => f.hunks.flatMap((h) => h.lines));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((l) => l.layer === undefined)).toBe(true);
  });

  it('attributes a branch that is not checked out to local commits', async () => {
    const sel = await srv.json('POST', '/api/refs', {
      base: 'main',
      head: 'other',
    });
    expect(sel.status).toBe(200);
    const { body } = await srv.json<DiffResponse>(
      'GET',
      '/api/diff?attribute=1'
    );
    expect(changed(body, 'b.txt')).toEqual([
      { type: 'add', content: 'other branch', layer: 'local' },
    ]);
  });
});
