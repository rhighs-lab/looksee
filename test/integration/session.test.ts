import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, type Repo, seedRepo } from '@test/helpers/repo.js';
import { startTestServer, type TestServer } from '@test/helpers/server.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPin } from '@/server/git/snapshot.js';
import { computeRepoState } from '@/server/git/state.js';
import {
  endSession,
  ensureSession,
  getSession,
  pinApproved,
  repin,
  setScope,
} from '@/server/review/session.js';
import { repoKey } from '@/server/review/store.js';
import type { Review, Session } from '@/shared/protocol.js';

type ReviewRes = { review: Review };
const SHA = /^[0-9a-f]{40}$/;
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('review session', () => {
  let repo: Repo;
  let srv: TestServer;
  let home: string;
  let key: string;
  const pin = (name: string) => readPin(repo.dir, key, name);
  const refs = async (r: Repo = repo) =>
    (await r.git(['for-each-ref', '--format=%(refname)', 'refs/looksee/']))
      .split('\n')
      .filter(Boolean)
      .map((x) => x.split('/').pop());
  const head = async () => (await repo.git(['rev-parse', 'HEAD'])).trim();
  const submit = async (actor: string | undefined, verdict: string) => {
    const headers = actor ? { 'x-looksee-actor': actor } : undefined;
    const { body } = await srv.json<ReviewRes>(
      'POST',
      '/api/reviews',
      { branch: 'main' },
      headers
    );
    return srv.json<ReviewRes>(
      'POST',
      `/api/reviews/${body.review.id}/submit`,
      { verdict, body: '' },
      headers
    );
  };

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
    process.env['LOOKSEE_HOME'] = home;
    repo = await makeRepo();
    await seedRepo(repo);
    key = repoKey(repo.dir);
  });
  afterAll(async () => {
    await srv?.close();
    await repo.cleanup();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('ensureSession pins openedAt once', async () => {
    expect(await getSession(repo.dir)).toBeNull();
    const s = await ensureSession(repo.dir);
    expect(s.openedAt?.tree).toMatch(SHA);
    expect(s.openedAt?.head).toBe(await head());
    expect(Date.parse(s.openedAt?.at ?? '')).not.toBeNaN();
    expect(s).toMatchObject({
      approvedAt: null,
      scope: 'session',
      custom: null,
      endedAt: null,
    });
    expect(await pin('opened')).toBe(s.openedAt?.tree);
    expect(await pin('approved')).toBeNull();
    expect(await refs()).toEqual(['opened', 'opened-head']);
    expect(await readPin(repo.dir, key, 'opened-head')).toBe(await head());
    await settle();
    expect(await ensureSession(repo.dir)).toEqual(s);
    expect(await getSession(repo.dir)).toEqual(s);
  });

  it('server start reuses the live session', async () => {
    const before = await getSession(repo.dir);
    srv = await startTestServer({ repoRoot: repo.dir });
    expect(await getSession(repo.dir)).toEqual(before);
  });

  it('AE3: approve by a reviewer agent leaves approvedAt null', async () => {
    const { status, body } = await submit('reviewer', 'approve');
    expect(status).toBe(200);
    expect(body.review.verdict).toBe('approve');
    expect('comparison' in body.review).toBe(true);
    expect((await getSession(repo.dir))?.approvedAt).toBeNull();
    expect(await pin('approved')).toBeNull();
  });

  it('AE3: approve by user pins approvedAt and creates the ref', async () => {
    await repo.write('src/cart.js', 'export const cart = [];\n');
    const { status } = await submit(undefined, 'approve');
    expect(status).toBe(200);
    const s = await getSession(repo.dir);
    expect(s?.approvedAt?.tree).toMatch(SHA);
    expect(s?.approvedAt?.tree).not.toBe(s?.openedAt?.tree);
    expect(s?.approvedAt?.head).toBe(await head());
    expect(await pin('approved')).toBe(s?.approvedAt?.tree);
    expect(await pin('opened')).toBe(s?.openedAt?.tree);
  });

  it('user request_changes does not move approvedAt', async () => {
    const before = await getSession(repo.dir);
    await repo.write('src/cart.js', 'export const cart = [1];\n');
    const { status } = await submit(undefined, 'request_changes');
    expect(status).toBe(200);
    expect(await getSession(repo.dir)).toEqual(before);
  });

  it('AE8: a restarted server reads the same approvedAt', async () => {
    const before = await getSession(repo.dir);
    await srv.close();
    srv = await startTestServer({ repoRoot: repo.dir });
    const after = await getSession(repo.dir);
    expect(after).toEqual(before);
    expect(after?.approvedAt).not.toBeNull();
    expect(await pin('approved')).toBe(after?.approvedAt?.tree);
  });

  it('setScope persists the preset and custom comparison', async () => {
    const s = await setScope(repo.dir, 'custom', {
      baseline: { kind: 'head' },
      endpoint: { kind: 'index' },
    });
    expect(s.scope).toBe('custom');
    expect(s.custom).toEqual({
      baseline: { kind: 'head' },
      endpoint: { kind: 'index' },
    });
    const w = await setScope(repo.dir, 'working');
    expect(w.scope).toBe('working');
    expect(w.custom).toEqual(s.custom);
    expect(await getSession(repo.dir)).toEqual(w);
  });

  it('repin moves openedAt, clears approvedAt and drops the ref', async () => {
    const before = (await getSession(repo.dir)) as Session;
    await repo.write('src/cart.js', 'export const cart = [1, 2];\n');
    await settle();
    const s = await repin(repo.dir);
    expect(s.openedAt?.tree).toMatch(SHA);
    expect(s.openedAt?.tree).not.toBe(before.openedAt?.tree);
    expect(s.openedAt?.at > (before.openedAt?.at ?? '')).toBe(true);
    expect(s.approvedAt).toBeNull();
    expect(s.scope).toBe(before.scope);
    expect(s.endedAt).toBeNull();
    expect(await pin('opened')).toBe(s.openedAt?.tree);
    expect(await pin('approved')).toBeNull();
  });

  it('endSession removes both refs and the next ensure starts fresh', async () => {
    await pinApproved(repo.dir);
    expect(await pin('approved')).not.toBeNull();
    const ended = await endSession(repo.dir);
    expect(Date.parse(ended?.endedAt ?? '')).not.toBeNaN();
    expect(await pin('opened')).toBeNull();
    expect(await pin('approved')).toBeNull();
    expect(await refs()).toEqual([]);
    expect(await getSession(repo.dir)).toEqual(ended);
    await repo.write('src/cart.js', 'export const cart = [3];\n');
    await settle();
    const next = await ensureSession(repo.dir);
    expect(next.endedAt).toBeNull();
    expect(next.approvedAt).toBeNull();
    expect(next.openedAt?.tree).not.toBe(ended?.openedAt?.tree);
    expect(next.openedAt?.at > (ended?.endedAt ?? '')).toBe(true);
    expect(await pin('opened')).toBe(next.openedAt?.tree);
  });

  it('pins an unborn repo with an empty head', async () => {
    const bare = await makeRepo();
    try {
      await bare.write('a.txt', 'a\n');
      const s = await ensureSession(bare.dir);
      expect(s.openedAt?.tree).toMatch(SHA);
      expect(s.openedAt?.head).toBe('');
      expect(await readPin(bare.dir, repoKey(bare.dir), 'opened')).toBe(
        s.openedAt?.tree
      );
      expect(await refs(bare)).toEqual(['opened']);
      const st = await computeRepoState(
        bare.dir,
        { preset: 'session', custom: null, session: s, baseFlag: null },
        1
      );
      expect(st.comparison?.label).not.toMatch(/ {2}/);
      expect(st.comparison?.baseline.short).toBe(s.openedAt?.tree.slice(0, 7));
    } finally {
      await bare.cleanup();
    }
  });

  it('a failed store write leaves no refs behind', async () => {
    const other = await makeRepo();
    const ro = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-ro-'));
    process.env['LOOKSEE_HOME'] = ro;
    try {
      await seedRepo(other);
      await fs.chmod(ro, 0o500);
      await expect(ensureSession(other.dir)).rejects.toThrow(/EACCES/);
      expect(await refs(other)).toEqual([]);
    } finally {
      process.env['LOOKSEE_HOME'] = home;
      await fs.chmod(ro, 0o700);
      await fs.rm(ro, { recursive: true, force: true });
      await other.cleanup();
    }
  });
});
