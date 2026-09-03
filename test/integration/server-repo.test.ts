import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  featureBranchWithLayers,
  makeRepo,
  type Repo,
  seedRepo,
} from '@test/helpers/repo.js';
import { startTestServer, type TestServer } from '@test/helpers/server.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ContextResponse,
  DiffResponse,
  FileViewResponse,
  HealthResponse,
  RepoState,
} from '@/shared/protocol.js';

let home: string;
beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
  process.env['LOOKSEE_HOME'] = home;
});
afterAll(() => fs.rm(home, { recursive: true, force: true }));

describe('repo API', () => {
  let repo: Repo;
  let srv: TestServer;
  beforeAll(async () => {
    repo = await makeRepo({ remote: true });
    await seedRepo(repo);
    await featureBranchWithLayers(repo);
    srv = await startTestServer({ repoRoot: repo.dir });
  });
  afterAll(async () => {
    await srv.close();
    await repo.cleanup();
  });

  it('reports health with the repo root', async () => {
    const { body } = await srv.json<HealthResponse>('GET', '/healthz');
    expect(body).toMatchObject({
      ok: true,
      app: 'looksee',
      repoRoot: repo.dir,
    });
  });

  it('serves the layered state', async () => {
    const { body } = await srv.json<RepoState>('GET', '/api/state');
    expect(body.version).toBeGreaterThan(0);
    expect(body.refs?.head.branch).toBe('feature/x');
    expect(body.files.map((f) => f.path)).toContain('src/index.js');
    expect(body.summary.byLayer.untracked).toBe(1);
  });

  it('serves the cumulative diff with highlighting and line counts', async () => {
    const { body } = await srv.json<DiffResponse>('GET', '/api/diff');
    const cart = body.files.find((f) => f.path === 'src/cart.js')!;
    expect(cart.rev).toBe('WORKTREE');
    expect(cart.newLineCount).toBe(40);
    expect(
      cart.hunks[0]!.lines.some((l) => l.html?.includes('class="tok'))
    ).toBe(true);
    expect(body.files.find((f) => f.path === 'src/old.js')).toMatchObject({
      kind: 'deleted',
      newLineCount: null,
    });
  });

  it('isolates a scope and filters by path', async () => {
    const { body } = await srv.json<DiffResponse>(
      'GET',
      '/api/diff?scope=staged'
    );
    expect(body.files.map((f) => f.path)).toEqual(['src/format.js']);
    expect(body.files[0]).toMatchObject({ rev: 'INDEX', oldRev: 'HEAD' });
    const one = await srv.json<DiffResponse>(
      'GET',
      '/api/diff?path=README.md&path=../etc/passwd'
    );
    expect(one.body.files.map((f) => f.path)).toEqual(['README.md']);
  });

  it('expands context from the requested revision', async () => {
    const { body } = await srv.json<ContextResponse>(
      'GET',
      '/api/context?path=src/cart.js&rev=WORKTREE&start=5&end=8'
    );
    expect(body.from).toBe(5);
    expect(body.lines).toHaveLength(4);
    expect(body.eof).toBe(false);
    const bad = await srv.json(
      'GET',
      '/api/context?path=src/cart.js&rev=--output=x&start=1&end=2'
    );
    expect(bad.status).toBe(400);
  });

  it('serves a whole file with changed lines and the repo tree', async () => {
    const { body } = await srv.json<FileViewResponse>(
      'GET',
      '/api/file?path=src/cart.js'
    );
    expect(body.lines).toHaveLength(40);
    expect(body.changedLines).toContain(1);
    expect(body.inDiff).toBe(true);
    expect(body.tree.find((t) => t.path === 'src/old.js')?.kind).toBe(
      'deleted'
    );
    const deleted = await srv.json<FileViewResponse>(
      'GET',
      '/api/file?path=src/old.js'
    );
    expect(deleted.body.deleted).toBe(true);
    expect(deleted.body.lines).toEqual(['export const gone = true;']);
    expect(
      (await srv.json('GET', '/api/file?path=../../etc/passwd')).status
    ).toBe(404);
  });

  it('rejects cross-origin writes', async () => {
    const r = await srv.json(
      'POST',
      '/api/comments',
      { filePath: 'README.md', side: 'file', body: 'x' },
      { origin: 'http://evil.example' }
    );
    expect(r.status).toBe(403);
  });
});

describe('live updates', () => {
  let repo: Repo;
  let srv: TestServer;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
    srv = await startTestServer({ repoRoot: repo.dir });
  });
  afterAll(async () => {
    await srv.close();
    await repo.cleanup();
  });

  it('coalesces rapid edits into one state change with a new digest', async () => {
    const tap = await srv.events();
    await tap.next('hello');
    const before = (await srv.json<RepoState>('GET', '/api/state')).body;
    for (let i = 0; i < 10; i++)
      await repo.write('README.md', `# fixture\n\nedit ${i}\n`);
    const ev = await tap.next('state.changed');
    expect(ev.type === 'state.changed' && ev.version).toBeGreaterThan(
      before.version
    );
    await new Promise((r) => setTimeout(r, 300));
    const after = (await srv.json<RepoState>('GET', '/api/state')).body;
    expect(
      after.files
        .find((f) => f.path === 'README.md')
        ?.layers.map((l) => l.layer)
    ).toEqual(['unstaged']);
    const changes = tap.all().filter((e) => e.type === 'state.changed');
    expect(changes.length).toBeLessThanOrEqual(3);
    tap.close();
  });

  it('notices staging and untracked files', async () => {
    const tap = await srv.events();
    await tap.next('hello');
    await repo.git(['add', 'README.md']);
    await tap.next('state.changed');
    await new Promise((r) => setTimeout(r, 200));
    let s = (await srv.json<RepoState>('GET', '/api/state')).body;
    expect(
      s.files.find((f) => f.path === 'README.md')?.layers.map((l) => l.layer)
    ).toEqual(['staged']);
    await repo.write('brand-new.txt', 'hi\n');
    await tap.next('state.changed');
    await new Promise((r) => setTimeout(r, 200));
    s = (await srv.json<RepoState>('GET', '/api/state')).body;
    expect(
      s.files
        .find((f) => f.path === 'brand-new.txt')
        ?.layers.map((l) => l.layer)
    ).toEqual(['untracked']);
    tap.close();
  });
});

describe('outside a repository', () => {
  it('serves the sample diff and no comments', async () => {
    const srv = await startTestServer({ repoRoot: null });
    try {
      const { body } = await srv.json<RepoState>('GET', '/api/state');
      expect(body.repoRoot).toBeNull();
      expect(body.files.length).toBeGreaterThan(0);
      const diff = await srv.json<DiffResponse>('GET', '/api/diff');
      expect(diff.body.files.some((f) => f.binary)).toBe(true);
      expect((await srv.json('GET', '/api/comments')).body).toEqual({
        comments: [],
      });
      expect(
        (await srv.json('GET', '/api/context?path=x&start=1&end=2')).status
      ).toBe(400);
    } finally {
      await srv.close();
    }
  });
});

describe('base and compare selection', () => {
  let repo: Repo;
  let srv: TestServer;
  beforeAll(async () => {
    repo = await makeRepo({ remote: true });
    await seedRepo(repo);
    await featureBranchWithLayers(repo);
    srv = await startTestServer({ repoRoot: repo.dir });
  });
  afterAll(async () => {
    await srv.close();
    await repo.cleanup();
  });

  it('lists local and remote branches', async () => {
    const { body } = await srv.json<{
      current: string;
      local: string[];
      remote: string[];
    }>('GET', '/api/branches');
    expect(body.current).toBe('feature/x');
    expect(body.local).toEqual(['feature/x', 'main']);
    expect(body.remote).toEqual(
      expect.arrayContaining(['origin/feature/x', 'origin/main'])
    );
  });

  it('compares a branch that is not checked out without touching the working tree', async () => {
    const tap = await srv.events();
    await tap.next('hello');
    const r = await srv.json<RepoState>('POST', '/api/refs', {
      base: 'main',
      head: 'origin/feature/x',
    });
    expect(r.status).toBe(200);
    expect(r.body.refs?.head).toMatchObject({
      branch: 'origin/feature/x',
      checkedOut: false,
    });
    expect(r.body.files.map((f) => f.path).sort()).toEqual([
      'src/cart.js',
      'src/old.js',
    ]);
    expect(r.body.summary.byLayer.unstaged).toBe(0);
    await tap.next('state.changed');
    const diff = await srv.json<DiffResponse>('GET', '/api/diff');
    expect(diff.body.files.every((f) => f.rev !== 'WORKTREE')).toBe(true);
    expect(
      (await srv.json('POST', '/api/refs', { head: '--upload-pack=x' })).status
    ).toBe(400);
    expect(
      (await srv.json('POST', '/api/refs', { head: 'nope/nope' })).status
    ).toBe(400);
    const back = await srv.json<RepoState>('POST', '/api/refs', { head: null });
    expect(back.body.refs?.head).toMatchObject({
      branch: 'feature/x',
      checkedOut: true,
    });
    expect(back.body.summary.byLayer.unstaged).toBe(1);
    tap.close();
  });

  it('switches the base branch and reports its source', async () => {
    const r = await srv.json<RepoState>('POST', '/api/refs', {
      base: 'origin/main',
    });
    expect(r.body.refs?.base).toMatchObject({
      ref: 'origin/main',
      source: 'flag',
    });
    const reset = await srv.json<RepoState>('POST', '/api/refs', {
      base: null,
    });
    expect(reset.body.refs?.base).toMatchObject({
      ref: 'main',
      source: 'upstream-base',
    });
  });
});
