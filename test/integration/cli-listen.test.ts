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
import { type Io, run } from '@/cli/main.js';
import type { DecoratedComment, Review } from '@/shared/protocol.js';

type Line = Record<string, unknown> & { type: string };
type Listener = {
  lines: () => Line[];
  until: (pred: (lines: Line[]) => boolean) => Promise<Line[]>;
  stop: () => Promise<{ code: number; out: string; err: string }>;
  done: Promise<number>;
};
const FILE = 'src/cart.js';

describe('cli listen', () => {
  let repo: Repo;
  let srv: TestServer;
  let home: string;

  const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    LOOKSEE_URL: srv.base,
    LOOKSEE_HOME: home,
    ...extra,
  });

  const cli = async (argv: string[], extra: NodeJS.ProcessEnv = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: (s) => void out.push(s),
      err: (s) => void err.push(s),
      env: env(extra),
      stdin: async () => '',
    };
    const code = await run(argv, io);
    return { code, out: out.join(''), err: err.join('') };
  };

  const listen = (argv: string[], extra: NodeJS.ProcessEnv = {}): Listener => {
    const ctrl = new AbortController();
    let out = '';
    let err = '';
    const io: Io = {
      out: (s) => void (out += s),
      err: (s) => void (err += s),
      env: env(extra),
      stdin: async () => '',
      signal: ctrl.signal,
    };
    const done = run(['listen', ...argv], io);
    const lines = (): Line[] =>
      out
        .split('\n')
        .filter((l) => l.length)
        .map((l) => JSON.parse(l) as Line);
    const until = (pred: (ls: Line[]) => boolean): Promise<Line[]> =>
      new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
          const ls = lines();
          if (pred(ls)) return resolve(ls);
          if (Date.now() - t0 > 5000)
            return reject(new Error(`timed out; got ${out}`));
          setTimeout(tick, 20);
        };
        tick();
      });
    const stop = async () => {
      ctrl.abort();
      const code = await done;
      return { code, out, err };
    };
    return { lines, until, stop, done };
  };

  const has = (type: string) => (ls: Line[]) => ls.some((l) => l.type === type);

  const post = async <T>(
    p: string,
    body: unknown,
    actor?: string
  ): Promise<T> => {
    const r = await srv.json<T>(
      'POST',
      p,
      body,
      actor ? { 'x-looksee-actor': actor } : {}
    );
    expect(r.status).toBe(200);
    return r.body;
  };

  const single = async (body: string, line: number, actor?: string) => {
    const lines = (await fs.readFile(path.join(repo.dir, FILE), 'utf8')).split(
      '\n'
    );
    const { comment } = await post<{ comment: DecoratedComment }>(
      '/api/comments',
      {
        filePath: FILE,
        side: 'new',
        startLine: line,
        endLine: line,
        lineSnapshot: lines.slice(line - 1, line),
        body,
      },
      actor
    );
    return comment;
  };

  const submitReview = async (actor: string, verdict: string, body: string) => {
    const { review } = await post<{ review: Review }>(
      '/api/reviews',
      { branch: 'feature/x' },
      actor
    );
    await post(
      '/api/comments',
      {
        filePath: FILE,
        side: 'new',
        startLine: 1,
        endLine: 1,
        lineSnapshot: ['x'],
        body,
        reviewId: review.id,
      },
      actor
    );
    return post<{ review: Review; comments: DecoratedComment[] }>(
      `/api/reviews/${review.id}/submit`,
      { verdict },
      actor
    );
  };

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
    process.env['LOOKSEE_HOME'] = home;
    repo = await makeRepo();
    await seedRepo(repo);
    await featureBranchWithLayers(repo);
    srv = await startTestServer({ repoRoot: repo.dir });
  });
  afterAll(async () => {
    await srv.close();
    await repo.cleanup();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('prints hello first with a guide, and without it under --quiet', async () => {
    const l = listen([]);
    const [hello] = await l.until((ls) => ls.length >= 1);
    expect(hello?.type).toBe('hello');
    expect(hello?.['actor']).toBe('agent');
    expect(typeof hello?.['guide']).toBe('string');
    expect(String(hello?.['guide'])).toContain('looksee reply');
    expect(String(hello?.['guide'])).toContain('looksee resolve');
    const r = await l.stop();
    expect(r.code).toBe(0);
    expect(r.err).toBe('');

    const q = listen(['--quiet', '--as', 'bot']);
    const [qh] = await q.until((ls) => ls.length >= 1);
    expect(qh?.type).toBe('hello');
    expect(qh?.['actor']).toBe('bot');
    expect(qh).not.toHaveProperty('guide');
    expect((await q.stop()).code).toBe(0);
  });

  it('AE4: --not-me drops own replies and passes review.submitted with expects', async () => {
    const root = await single('please fix', 2);
    const l = listen(['--not-me', '--as', 'implementer']);
    await l.until(has('hello'));
    const reply = await cli(['reply', root.id, 'done'], {
      LOOKSEE_ACTOR: 'implementer',
    });
    expect(reply.code).toBe(0);
    const submitted = await submitReview('reviewer', 'request_changes', 'nit');
    const ls = await l.until(has('review.submitted'));
    expect(ls.map((x) => x.type)).toEqual(['hello', 'review.submitted']);
    const ev = ls[1] as Line & {
      review: Review;
      comments: (DecoratedComment & { expects: string })[];
      expects: string;
    };
    expect(ev.review.id).toBe(submitted.review.id);
    expect(ev.review.author).toBe('reviewer');
    expect(ev.expects).toBe('fix, reply and resolve every thread');
    expect(ev.comments).toHaveLength(1);
    expect(ev.comments[0]?.expects).toBe('fix and reply');
    expect(ev.comments[0]?.lineSnapshot).toEqual(['x']);
    expect(ev).not.toHaveProperty('replay');
    expect((await l.stop()).code).toBe(0);
  });

  it('AE5: --pending replays unanswered roots and unresolved reviews first', async () => {
    const asked = await single('unanswered', 3);
    const answered = await single('answered', 4);
    const r = await cli(['reply', answered.id, 'on it'], {
      LOOKSEE_ACTOR: 'agent',
    });
    expect(r.code).toBe(0);
    const rv = await submitReview('reviewer', 'request_changes', 'change');
    const l = listen(['--pending', '--as', 'agent']);
    const replayed = await l.until(
      (ls) =>
        ls.filter((x) => x['replay'] === true).length >= 2 &&
        ls.some((x) => x.type === 'comment.created')
    );
    expect(replayed[0]?.type).toBe('hello');
    const live = await single('live one', 5);
    const ls = await l.until((ls) =>
      ls.some((x) => (x['comment'] as DecoratedComment)?.id === live.id)
    );
    const replays = ls.filter((x) => x['replay'] === true);
    const roots = replays
      .filter((x) => x.type === 'comment.created')
      .map((x) => x['comment'] as DecoratedComment & { expects: string });
    expect(roots.some((c) => c.id === asked.id)).toBe(true);
    expect(roots.some((c) => c.id === answered.id)).toBe(false);
    expect(roots.find((c) => c.id === asked.id)?.expects).toBe('fix and reply');
    const reviews = replays
      .filter((x) => x.type === 'review.submitted')
      .map((x) => x['review'] as Review);
    expect(reviews.some((x) => x.id === rv.review.id)).toBe(true);
    const liveIdx = ls.findIndex(
      (x) => (x['comment'] as DecoratedComment)?.id === live.id
    );
    const lastReplay = ls.map((x) => x['replay'] === true).lastIndexOf(true);
    expect(lastReplay).toBeLessThan(liveIdx);
    expect(ls[liveIdx]).not.toHaveProperty('replay');
    expect((await l.stop()).code).toBe(0);

    for (const c of rv.comments) {
      const res = await cli(['resolve', c.id], { LOOKSEE_ACTOR: 'agent' });
      expect(res.code).toBe(0);
    }
    const again = listen(['--pending', '--as', 'agent']);
    const ls2 = await again.until((ls) =>
      ls.some(
        (x) =>
          x['replay'] === true &&
          (x['comment'] as DecoratedComment)?.id === asked.id
      )
    );
    await new Promise((res) => setTimeout(res, 100));
    expect(
      again
        .lines()
        .some(
          (x) =>
            x.type === 'review.submitted' &&
            (x['review'] as Review).id === rv.review.id
        )
    ).toBe(false);
    expect(ls2.length).toBeGreaterThan(1);
    expect((await again.stop()).code).toBe(0);
  });

  it('draft edits and state.changed print nothing', async () => {
    const l = listen([]);
    await l.until(has('hello'));
    const { review } = await post<{ review: Review }>(
      '/api/reviews',
      { branch: null },
      'reviewer'
    );
    const { comment } = await post<{ comment: DecoratedComment }>(
      '/api/comments',
      {
        filePath: FILE,
        side: 'new',
        startLine: 1,
        endLine: 1,
        lineSnapshot: ['x'],
        body: 'draft',
        reviewId: review.id,
      },
      'reviewer'
    );
    const patched = await srv.json(
      'PATCH',
      `/api/comments/${comment.id}`,
      { body: 'draft edited' },
      { 'x-looksee-actor': 'reviewer' }
    );
    expect(patched.status).toBe(200);
    srv.looksee.ctx.hub.emit({ type: 'state.changed', version: 99 });
    srv.looksee.ctx.hub.emit({
      type: 'diff.changed',
      path: FILE,
      origin: null,
    });
    const sentinel = await single('sentinel', 6);
    const ls = await l.until((ls) =>
      ls.some((x) => (x['comment'] as DecoratedComment)?.id === sentinel.id)
    );
    expect(ls.map((x) => x.type)).toEqual(['hello', 'comment.created']);
    const del = await srv.json(
      'DELETE',
      `/api/reviews/${review.id}`,
      undefined,
      {
        'x-looksee-actor': 'reviewer',
      }
    );
    expect(del.status).toBe(200);
    expect((await l.stop()).code).toBe(0);
  });

  it('every line is JSON with a type across the R16 set', async () => {
    const l = listen(['--as', 'watcher']);
    await l.until(has('hello'));
    const root = await single('check this', 7);
    await cli(['reply', root.id, 'looked'], { LOOKSEE_ACTOR: 'bot' });
    await cli(['resolve', root.id], { LOOKSEE_ACTOR: 'bot' });
    await srv.json(
      'PATCH',
      `/api/comments/${root.id}`,
      { status: 'open' },
      { 'x-looksee-actor': 'bot' }
    );
    const ls = await l.until(has('thread.reopened'));
    expect(ls.map((x) => x.type)).toEqual([
      'hello',
      'comment.created',
      'comment.replied',
      'thread.resolved',
      'thread.reopened',
    ]);
    for (const x of ls) expect(typeof x.type).toBe('string');
    const replied = ls[2] as Line & { comment: { expects: string } };
    expect(replied.comment.expects).toBe('fix and reply');
    const r = await l.stop();
    expect(r.code).toBe(0);
    expect(r.out.endsWith('\n')).toBe(true);
  });

  it('--wait returns after the first event and stops on its own', async () => {
    const l = listen(['--wait', '5', '--as', 'poller']);
    await l.until(has('hello'));
    const c = await single('waited for', 8, 'reviewer');
    expect(await l.done).toBe(0);
    const ls = l.lines();
    expect(ls.map((x) => x.type)).toEqual(['hello', 'comment.created']);
    expect((ls[1]?.['comment'] as DecoratedComment | undefined)?.id).toBe(c.id);
  });

  it('--wait gives up after the timeout with nothing but hello', async () => {
    const l = listen(['--wait', '1', '--as', 'poller']);
    const t0 = Date.now();
    expect(await l.done).toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(l.lines().map((x) => x.type)).toEqual(['hello']);
  });

  it('--wait with --pending returns the replay without waiting', async () => {
    const root = await single('still open', 9, 'reviewer');
    const l = listen(['--wait', '30', '--pending', '--not-me', '--as', 'bot']);
    expect(await l.done).toBe(0);
    const ls = l.lines();
    expect(ls[0]?.type).toBe('hello');
    expect(
      ls.some((x) => (x['comment'] as DecoratedComment)?.id === root.id)
    ).toBe(true);
  });

  it('exits 1 with one stderr line when the server goes away', async () => {
    const other = await startTestServer({ repoRoot: repo.dir });
    const l = listen([], { LOOKSEE_URL: other.base, LOOKSEE_RETRY_MS: '300' });
    await l.until(has('hello'));
    const t0 = Date.now();
    await other.close();
    const code = await l.done;
    expect(code).toBe(1);
    expect(Date.now() - t0).toBeLessThan(4000);
    const r = await l.stop();
    expect(r.err.endsWith('\n')).toBe(true);
    expect(r.err.trim().split('\n')).toHaveLength(1);
    expect(l.lines().map((x) => x.type)).toEqual(['hello']);
  });
});
