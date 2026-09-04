import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  featureBranchWithLayers,
  makeRepo,
  padLines,
  type Repo,
  seedRepo,
} from '@test/helpers/repo.js';
import { startTestServer, type TestServer } from '@test/helpers/server.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { repoKey } from '@/server/review/store.js';
import type {
  ChangedFile,
  DiffResponse,
  RepoState,
  Review,
  Session,
} from '@/shared/protocol.js';

let home: string;
beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
  process.env['LOOKSEE_HOME'] = home;
});
afterAll(() => fs.rm(home, { recursive: true, force: true }));

const poll = async <T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  ms = 4000
): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
};

const shape = (files: ChangedFile[]) =>
  files
    .filter((f) => f.kind !== 'unchanged')
    .map((f) => [
      f.path,
      f.oldPath,
      f.kind,
      f.additions,
      f.deletions,
      f.layers.map((l) => `${l.layer}:${l.kind}`),
    ]);

const changed = (s: RepoState) =>
  s.files
    .filter((f) => f.kind !== 'unchanged')
    .map((f) => f.path)
    .sort();

const state = async (srv: TestServer) =>
  (await srv.json<RepoState>('GET', '/api/state')).body;

const approve = async (srv: TestServer) => {
  const { body } = await srv.json<{ review: Review }>('POST', '/api/reviews', {
    branch: 'main',
  });
  return srv.json('POST', `/api/reviews/${body.review.id}/submit`, {
    verdict: 'approve',
    body: '',
  });
};

describe('session scope', () => {
  let repo: Repo;
  let srv: TestServer | null = null;
  beforeAll(async () => {
    repo = await makeRepo({ remote: true });
    await seedRepo(repo);
  });
  afterEach(async () => {
    await srv?.json('POST', '/api/session/end');
    await srv?.close();
    srv = null;
  });
  afterAll(() => repo.cleanup());

  it('AE1: a dirty tree with an untracked file opens with zero changes', async () => {
    await repo.write('README.md', '# fixture\n\ndirty\n');
    await repo.write('notes.txt', 'untracked\n');
    srv = await startTestServer({ repoRoot: repo.dir });
    const s = await state(srv);
    expect(s.comparison?.preset).toBe('session');
    expect(s.comparison?.baseline.kind).toBe('pin');
    expect(s.comparison?.endpoint.kind).toBe('worktree');
    expect(s.comparison?.label).toMatch(
      /^Since session start [0-9a-f]{7} to workspace$/
    );
    expect(s.drift).toBe(false);
    expect(s.summary.files).toBe(0);
    expect(changed(s)).toEqual([]);
    expect(s.summary.byLayer).toMatchObject({ unstaged: 1, untracked: 1 });
    await repo.git(['checkout', '-q', '--', 'README.md']);
    await repo.rm('notes.txt');
  });

  it('AE2: approve empties the session and the next edit shows alone', async () => {
    srv = await startTestServer({ repoRoot: repo.dir });
    const at = srv;
    expect(changed(await state(at))).toEqual([]);
    await repo.write('src/a.js', 'a\n');
    await repo.commitAll('a');
    await repo.write('src/b.js', 'b\n');
    await repo.commitAll('b');
    let s = await poll(
      () => state(at),
      (x) => changed(x).length === 2
    );
    expect(changed(s)).toEqual(['src/a.js', 'src/b.js']);
    expect(
      s.files.find((f) => f.path === 'src/a.js')?.layers.map((l) => l.layer)
    ).toEqual(['local']);
    const r = await approve(at);
    expect(r.status).toBe(200);
    s = await poll(
      () => state(at),
      (x) => x.comparison?.label.startsWith('Since approval') ?? false
    );
    expect(changed(s)).toEqual([]);
    expect(s.comparison?.label).toMatch(
      /^Since approval [0-9a-f]{7} to workspace$/
    );
    await repo.write('src/b.js', 'b2\n');
    s = await poll(
      () => state(at),
      (x) => changed(x).length === 1
    );
    expect(changed(s)).toEqual(['src/b.js']);
    await repo.git(['checkout', '-q', '--', 'src/b.js']);
  });

  it('AE4: a rebase that rewrites the pinned head reports drift and keeps files', async () => {
    await repo.git(['checkout', '-qb', 'feature/drift']);
    await repo.write('src/feat.js', 'feat\n');
    await repo.commitAll('feat');
    srv = await startTestServer({ repoRoot: repo.dir });
    const at = srv;
    expect((await state(at)).drift).toBe(false);
    await repo.git(['checkout', '-q', 'main']);
    await repo.write('src/main-only.js', 'm\n');
    await repo.commitAll('main moves');
    await repo.git(['checkout', '-q', 'feature/drift']);
    await repo.git(['rebase', '-q', 'main']);
    const s = await poll(
      () => state(at),
      (x) => x.drift
    );
    expect(s.drift).toBe(true);
    expect(changed(s)).toEqual(['src/main-only.js']);
    await repo.git(['checkout', '-q', 'main']);
  });

  it('fires state.changed after a re-pin with no file change', async () => {
    srv = await startTestServer({ repoRoot: repo.dir });
    const tap = await srv.events();
    await tap.next('hello');
    const before = await state(srv);
    expect(changed(before)).toEqual([]);
    const pin = (await srv.json<Session>('GET', '/api/session')).body;
    expect(pin.openedAt).not.toBeNull();
    const r = await srv.json<RepoState>('POST', '/api/session/pin');
    expect(r.status).toBe(200);
    const ev = await tap.next('state.changed');
    expect(ev.type === 'state.changed' && ev.version).toBeGreaterThan(
      before.version
    );
    const after = (await srv.json<Session>('GET', '/api/session')).body;
    expect(after.openedAt?.at).not.toBe(pin.openedAt?.at);
    expect(r.body.comparison?.baseline.oid).toBe(after.openedAt?.tree);
    tap.close();
  });
});

describe('scope presets on the default branch', () => {
  let repo: Repo;
  let srv: TestServer;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
    await repo.write('README.md', '# fixture\n\nedited\n');
    await repo.write('src/new.js', 'new\n');
    srv = await startTestServer({ repoRoot: repo.dir });
  });
  afterAll(async () => {
    await srv.close();
    await repo.cleanup();
  });

  it('working equals git diff HEAD plus untracked files', async () => {
    const r = await srv.json<RepoState>('POST', '/api/scope', {
      preset: 'working',
    });
    expect(r.status).toBe(200);
    expect(r.body.comparison).toMatchObject({
      preset: 'working',
      baseline: { kind: 'head' },
      endpoint: { kind: 'worktree' },
      note: null,
    });
    expect(r.body.comparison?.label).toMatch(/^HEAD [0-9a-f]{7} to workspace$/);
    const tracked = (await repo.git(['diff', '--name-only', 'HEAD']))
      .split('\n')
      .filter(Boolean);
    const untracked = (
      await repo.git(['ls-files', '--others', '--exclude-standard'])
    )
      .split('\n')
      .filter(Boolean);
    expect(changed(r.body)).toEqual([...tracked, ...untracked].sort());
    const session = (await srv.json<Session>('GET', '/api/session')).body;
    expect(session.scope).toBe('working');
  });

  it('AE5: branch on the default branch equals working with a note', async () => {
    const working = changed(await state(srv));
    const r = await srv.json<RepoState>('POST', '/api/scope', {
      preset: 'branch',
    });
    expect(r.status).toBe(200);
    expect(r.body.comparison?.preset).toBe('branch');
    expect(r.body.comparison?.note).toBe('same-as-working');
    expect(changed(r.body)).toEqual(working);
  });

  it('AE9: head to index omits untracked files, head to worktree lists them', async () => {
    const toIndex = await srv.json<RepoState>('POST', '/api/scope', {
      preset: 'custom',
      custom: { baseline: { kind: 'head' }, endpoint: { kind: 'index' } },
    });
    expect(toIndex.status).toBe(200);
    expect(toIndex.body.comparison?.endpoint.kind).toBe('index');
    expect(changed(toIndex.body)).not.toContain('src/new.js');
    const toTree = await srv.json<RepoState>('POST', '/api/scope', {
      preset: 'custom',
      custom: { baseline: { kind: 'head' }, endpoint: { kind: 'worktree' } },
    });
    expect(changed(toTree.body)).toContain('src/new.js');
    const diff = await srv.json<DiffResponse>('GET', '/api/diff');
    expect(diff.body.files.find((f) => f.path === 'src/new.js')?.rev).toBe(
      'WORKTREE'
    );
    expect(diff.body.files[0]?.oldRev).toBe(
      toTree.body.comparison?.baseline.oid
    );
  });

  it('rejects bad presets and unsafe custom endpoints', async () => {
    expect(
      (await srv.json('POST', '/api/scope', { preset: 'nope' })).status
    ).toBe(400);
    expect(
      (
        await srv.json('POST', '/api/scope', {
          preset: 'custom',
          custom: {
            baseline: { kind: 'ref', name: '--upload-pack=x' },
            endpoint: { kind: 'worktree' },
          },
        })
      ).status
    ).toBe(400);
    expect(
      (
        await srv.json('POST', '/api/scope', {
          preset: 'custom',
          custom: {
            baseline: { kind: 'ref', name: 'nope/nope' },
            endpoint: { kind: 'worktree' },
          },
        })
      ).status
    ).toBe(400);
    const s = (await srv.json<Session>('GET', '/api/session')).body;
    expect(s.custom).toEqual({
      baseline: { kind: 'head' },
      endpoint: { kind: 'worktree' },
    });
  });
});

describe('custom preset without a comparison', () => {
  let repo: Repo;
  let srv: TestServer;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
    await fs.writeFile(
      path.join(home, `${repoKey(repo.dir)}.json`),
      JSON.stringify({
        version: 3,
        repoRoot: repo.dir,
        reviews: [],
        comments: [],
        done: [],
        session: {
          openedAt: null,
          approvedAt: null,
          scope: 'custom',
          custom: { baseline: { kind: 'nope' } },
          endedAt: null,
        },
      })
    );
    srv = await startTestServer({ repoRoot: repo.dir });
  });
  afterAll(async () => {
    await srv.close();
    await repo.cleanup();
  });

  it('computes state and falls back to the session comparison', async () => {
    const s = await state(srv);
    expect(s.error).toBeNull();
    expect(s.comparison).toMatchObject({
      preset: 'custom',
      baseline: { kind: 'head' },
      endpoint: { kind: 'worktree' },
    });
    const sess = (await srv.json<Session>('GET', '/api/session')).body;
    expect(sess.scope).toBe('custom');
    expect(sess.custom).toBeNull();
  });
});

describe('branch preset on a feature branch', () => {
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

  it('reproduces the characterized file list and layers over trees', async () => {
    const r = await srv.json<RepoState>('POST', '/api/scope', {
      preset: 'branch',
    });
    expect(r.body.comparison?.label).toMatch(
      /^main [0-9a-f]{7} \(merge base\) to workspace$/
    );
    expect(r.body.comparison?.note).toBeNull();
    expect(shape(r.body.files)).toEqual([
      ['README.md', null, 'modified', 2, 0, ['unstaged:modified']],
      ['src/cart.js', null, 'modified', 2, 2, ['pushed:modified']],
      ['src/format.js', null, 'modified', 1, 1, ['staged:modified']],
      ['src/index.js', null, 'added', 2, 0, ['untracked:added']],
      ['src/local.js', null, 'added', 1, 0, ['local:added']],
      ['src/old.js', null, 'deleted', 0, 1, ['pushed:deleted']],
    ]);
    expect(r.body.summary).toEqual({
      files: 6,
      additions: 8,
      deletions: 4,
      byLayer: {
        pushed: 2,
        local: 1,
        staged: 1,
        unstaged: 1,
        untracked: 1,
        conflicted: 0,
      },
    });
  });

  it('POST /api/refs switches to a custom comparison', async () => {
    const r = await srv.json<RepoState>('POST', '/api/refs', {
      base: 'main',
      head: 'origin/feature/x',
    });
    expect(r.status).toBe(200);
    expect(r.body.comparison?.preset).toBe('custom');
    expect(r.body.comparison?.baseline.kind).toBe('merge-base');
    expect(changed(r.body)).toEqual(['src/cart.js', 'src/old.js']);
    const s = (await srv.json<Session>('GET', '/api/session')).body;
    expect(s.scope).toBe('custom');
    expect(s.custom).toEqual({
      baseline: { kind: 'merge-base', left: 'main', right: 'origin/feature/x' },
      endpoint: { kind: 'ref', name: 'origin/feature/x' },
    });
    const back = await srv.json<RepoState>('POST', '/api/scope', {
      preset: 'session',
    });
    expect(back.body.refs?.head).toMatchObject({
      branch: 'feature/x',
      checkedOut: true,
    });
    expect(back.body.comparison?.preset).toBe('session');
  });

  it('ends the session and falls back to a working comparison', async () => {
    const r = await srv.json<RepoState>('POST', '/api/session/end');
    expect(r.status).toBe(200);
    expect(r.body.comparison?.baseline.kind).toBe('head');
    const s = (await srv.json<Session>('GET', '/api/session')).body;
    expect(s.endedAt).not.toBeNull();
  });
});

describe('conflicts in a worktree endpoint', () => {
  let repo: Repo;
  let srv: TestServer;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
    await repo.git(['checkout', '-qb', 'feature/conflict']);
    await repo.write(
      'src/cart.js',
      padLines(
        ['export function total(items) {', '  return items.length * 2;', '}'],
        40
      )
    );
    await repo.commitAll('double');
    await repo.git(['checkout', '-q', 'main']);
    await repo.write(
      'src/cart.js',
      padLines(
        ['export function total(items) {', '  return items.length * 3;', '}'],
        40
      )
    );
    await repo.commitAll('triple');
    await repo.git(['checkout', '-q', 'feature/conflict']);
    srv = await startTestServer({ repoRoot: repo.dir });
    await repo.git(['merge', 'main']).catch(() => {});
    await poll(
      () => state(srv),
      (x) => x.summary.byLayer.conflicted === 1
    );
  });
  afterAll(async () => {
    await srv.close();
    await repo.git(['merge', '--abort']).catch(() => {});
    await repo.cleanup();
  });

  it('lists the conflicted file with its marker content', async () => {
    const s = await state(srv);
    const f = s.files.find((x) => x.path === 'src/cart.js');
    expect(f?.kind).toBe('unmerged');
    expect(f?.layers.map((l) => l.layer)).toContain('conflicted');
    const diff = await srv.json<DiffResponse>(
      'GET',
      '/api/diff?path=src/cart.js'
    );
    const lines = diff.body.files[0]!.hunks.flatMap((h) =>
      h.lines.map((l) => l.content)
    );
    expect(lines).toContain('<<<<<<< HEAD');
    const toIndex = await srv.json<RepoState>('POST', '/api/scope', {
      preset: 'custom',
      custom: { baseline: { kind: 'head' }, endpoint: { kind: 'index' } },
    });
    expect(toIndex.body.comparison?.note).toBe('index-unmerged');
  });
});
