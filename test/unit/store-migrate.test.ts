import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addComment,
  addDone,
  discardReview,
  getReview,
  getSession,
  listComments,
  listDone,
  listReviews,
  type NewComment,
  PendingReviewError,
  setSession,
  startReview,
  submitReview,
} from '@/server/review/store.js';
import type { Comparison, Session } from '@/shared/protocol.js';

const storeFile = (home: string, repoRoot: string): string =>
  path.join(
    home,
    `${crypto.createHash('sha1').update(repoRoot).digest('hex').slice(0, 16)}.json`
  );

const v1Comment = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  parentId: null,
  filePath: 'a.js',
  side: 'new',
  startLine: 1,
  endLine: 1,
  body: 'hi',
  branch: 'main',
  lineSnapshot: ['x'],
  status: 'open',
  handoff: 'agent',
  applied: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const draft = (over: Partial<NewComment> = {}): NewComment => ({
  parentId: null,
  author: 'user',
  filePath: 'a.js',
  side: 'new',
  startLine: 1,
  endLine: 1,
  body: 'hi',
  branch: 'main',
  lineSnapshot: ['x'],
  reviewId: null,
  ...over,
});

describe('store v2', () => {
  let home: string;
  let repoRoot: string;
  let idx = 0;

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
    process.env['LOOKSEE_HOME'] = home;
  });
  beforeEach(() => {
    idx += 1;
    repoRoot = `/tmp/repo-${idx}`;
  });
  afterAll(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('migrates v1 authors and drops handoff on read', async () => {
    const file = storeFile(home, repoRoot);
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        repoRoot,
        comments: [
          v1Comment({ id: 'c1', author: 'claude' }),
          v1Comment({ id: 'c2' }),
        ],
      })
    );
    const list = await listComments(repoRoot, null);
    expect(list.map((c) => c.author)).toEqual(['agent', 'user']);
    expect(list.every((c) => !('handoff' in c))).toBe(true);
    expect(list.every((c) => c.reviewId === null)).toBe(true);
  });

  it('rewrites the file as v2 on the next write only', async () => {
    const file = storeFile(home, repoRoot);
    await fs.mkdir(home, { recursive: true });
    const raw = JSON.stringify({
      repoRoot,
      comments: [v1Comment({ id: 'c1', author: 'claude' })],
    });
    await fs.writeFile(file, raw);
    await listComments(repoRoot, null);
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
    await addComment(repoRoot, draft());
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as {
      version: number;
      reviews: unknown[];
      comments: { author: string; handoff?: unknown }[];
      done: unknown[];
    };
    expect(data.version).toBe(3);
    expect(data.reviews).toEqual([]);
    expect(data.done).toEqual([]);
    expect(data.comments[0]?.author).toBe('agent');
    expect('handoff' in (data.comments[0] ?? {})).toBe(false);
  });

  it('reads a v2 file with session null and writes v3 on the next write', async () => {
    const file = storeFile(home, repoRoot);
    await fs.mkdir(home, { recursive: true });
    const raw = JSON.stringify({
      version: 2,
      repoRoot,
      reviews: [],
      comments: [],
      done: [],
    });
    await fs.writeFile(file, raw);
    expect(await getSession(repoRoot)).toBeNull();
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
    const session: Session = {
      openedAt: { tree: 'a'.repeat(40), head: 'b'.repeat(40), at: 't0' },
      approvedAt: null,
      scope: 'session',
      custom: null,
      endedAt: null,
    };
    expect(await setSession(repoRoot, async () => session)).toEqual(session);
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as {
      version: number;
      session: Session;
    };
    expect(data.version).toBe(3);
    expect(data.session).toEqual(session);
    expect(await getSession(repoRoot)).toEqual(session);
  });

  it('drops a malformed custom comparison on read', async () => {
    const file = storeFile(home, repoRoot);
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 3,
        repoRoot,
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
    expect(await getSession(repoRoot)).toEqual({
      openedAt: null,
      approvedAt: null,
      scope: 'custom',
      custom: null,
      endedAt: null,
    });
  });

  it('keeps the session across other writes and passes it to updaters', async () => {
    const session: Session = {
      openedAt: { tree: 'a'.repeat(40), head: 'b'.repeat(40), at: 't0' },
      approvedAt: null,
      scope: 'working',
      custom: null,
      endedAt: null,
    };
    await setSession(repoRoot, async () => session);
    await addComment(repoRoot, draft());
    expect(await getSession(repoRoot)).toEqual(session);
    const ended = await setSession(repoRoot, async (cur) => ({
      ...cur!,
      endedAt: 't1',
    }));
    expect(ended.endedAt).toBe('t1');
    expect(await getSession(repoRoot)).toEqual(ended);
  });

  it('throws on a corrupt file and leaves it untouched', async () => {
    const file = storeFile(home, repoRoot);
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(file, '{not json');
    await expect(listComments(repoRoot, null)).rejects.toThrow();
    await expect(addComment(repoRoot, draft())).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('{not json');
  });

  it('allows one pending review per actor', async () => {
    const r1 = await startReview(repoRoot, { author: 'agent', branch: 'main' });
    expect(r1.state).toBe('pending');
    expect(r1.verdict).toBeNull();
    expect(r1.submittedAt).toBeNull();
    await expect(
      startReview(repoRoot, { author: 'agent', branch: 'main' })
    ).rejects.toBeInstanceOf(PendingReviewError);
    const r2 = await startReview(repoRoot, { author: 'user', branch: 'main' });
    expect(r2.id).not.toBe(r1.id);
    expect(await getReview(repoRoot, r1.id)).toEqual(r1);
    expect((await listReviews(repoRoot)).map((r) => r.id)).toEqual([
      r1.id,
      r2.id,
    ]);
    expect(
      (await listReviews(repoRoot, { author: 'user' })).map((r) => r.id)
    ).toEqual([r2.id]);
  });

  it('hides pending review comments from other viewers', async () => {
    const rv = await startReview(repoRoot, {
      author: 'reviewer',
      branch: 'main',
    });
    const mine = await startReview(repoRoot, {
      author: 'user',
      branch: 'main',
    });
    const hidden = await addComment(
      repoRoot,
      draft({ author: 'reviewer', reviewId: rv.id })
    );
    const own = await addComment(
      repoRoot,
      draft({ author: 'user', reviewId: mine.id })
    );
    const loose = await addComment(repoRoot, draft({ author: 'user' }));
    const ids = (list: { id: string }[]) => list.map((c) => c.id);
    expect(ids(await listComments(repoRoot, 'main', 'user'))).toEqual([
      own.id,
      loose.id,
    ]);
    expect(ids(await listComments(repoRoot, 'main', 'reviewer'))).toEqual([
      hidden.id,
      loose.id,
    ]);
    expect(ids(await listComments(repoRoot, 'main'))).toEqual([loose.id]);
  });

  it('submitReview flips state and reveals its comments', async () => {
    const rv = await startReview(repoRoot, {
      author: 'reviewer',
      branch: 'main',
    });
    const c = await addComment(
      repoRoot,
      draft({ author: 'reviewer', reviewId: rv.id })
    );
    const done = await submitReview(repoRoot, rv.id, {
      verdict: 'request_changes',
      body: 'please fix',
    });
    expect(done?.state).toBe('submitted');
    expect(done?.verdict).toBe('request_changes');
    expect(done?.body).toBe('please fix');
    expect(done?.submittedAt).not.toBeNull();
    expect(done?.comparison).toBeNull();
    expect(
      (await listComments(repoRoot, 'main', 'user')).map((x) => x.id)
    ).toEqual([c.id]);
    expect(await getReview(repoRoot, rv.id)).toEqual(done);
    expect(
      await submitReview(repoRoot, 'nope', { verdict: 'approve', body: '' })
    ).toBeNull();
  });

  it('submitReview records the comparison it was given', async () => {
    const rv = await startReview(repoRoot, { author: 'user', branch: 'main' });
    expect(rv.comparison).toBeNull();
    const comparison: Comparison = {
      baseline: { kind: 'pin', name: 'opened' },
      endpoint: { kind: 'worktree' },
    };
    const done = await submitReview(repoRoot, rv.id, {
      verdict: 'approve',
      body: '',
      comparison,
    });
    expect(done?.comparison).toEqual(comparison);
    expect((await getReview(repoRoot, rv.id))?.comparison).toEqual(comparison);
  });

  it('discardReview removes the review, its comments and replies', async () => {
    const rv = await startReview(repoRoot, {
      author: 'reviewer',
      branch: 'main',
    });
    const root = await addComment(
      repoRoot,
      draft({ author: 'reviewer', reviewId: rv.id })
    );
    await addComment(
      repoRoot,
      draft({ author: 'user', parentId: root.id, reviewId: null })
    );
    const keep = await addComment(repoRoot, draft({ author: 'user' }));
    expect(await discardReview(repoRoot, rv.id)).toBe(true);
    expect(await getReview(repoRoot, rv.id)).toBeNull();
    expect(
      (await listComments(repoRoot, null, 'reviewer')).map((x) => x.id)
    ).toEqual([keep.id]);
    expect(await discardReview(repoRoot, rv.id)).toBe(false);
  });

  it('addDone appends and listDone keeps insertion order', async () => {
    const a = await addDone(repoRoot, { actor: 'agent', body: 'round 1' });
    const b = await addDone(repoRoot, { actor: 'agent', body: 'round 2' });
    expect(a.at <= b.at).toBe(true);
    expect(await listDone(repoRoot)).toEqual([a, b]);
  });
});
