import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  featureBranchWithLayers,
  makeRepo,
  type Repo,
  seedRepo,
} from '@test/helpers/repo.js';
import {
  type EventTap,
  startTestServer,
  type TestServer,
} from '@test/helpers/server.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Io, run } from '@/cli/main.js';
import type {
  DecoratedComment,
  RepoState,
  ResolvedComparison,
  Review,
  ServerEvent,
  Session,
} from '@/shared/protocol.js';

type Thread = DecoratedComment & {
  expects: string;
  replies: DecoratedComment[];
};
type ReviewRes = { review: Review; comments: DecoratedComment[] };
type Status = {
  running: boolean;
  url: string | null;
  scope: string | null;
  openedAt: string | null;
  approvedAt: string | null;
  drift: boolean;
};
const SHORT = /^[0-9a-f]{7}$/;
const FILE = 'src/cart.js';
const EVENTS: ServerEvent['type'][] = [
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'comment.replied',
  'review.submitted',
  'thread.resolved',
  'thread.reopened',
];
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('cli commands', () => {
  let repo: Repo;
  let srv: TestServer;
  let home: string;
  let tap: EventTap;
  const ids: Record<string, string> = {};

  const cli = async (
    argv: string[],
    env: NodeJS.ProcessEnv = {},
    stdin = ''
  ) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: (s) => void out.push(s),
      err: (s) => void err.push(s),
      env: { LOOKSEE_URL: srv.base, LOOKSEE_HOME: home, ...env },
      stdin: async () => stdin,
    };
    const code = await run(argv, io);
    return { code, out: out.join(''), err: err.join('') };
  };
  const json = <T>(s: string): T => JSON.parse(s) as T;
  const seed = async (body: string, line: number) => {
    const lines = (await fs.readFile(path.join(repo.dir, FILE), 'utf8')).split(
      '\n'
    );
    const r = await srv.json<{ comment: DecoratedComment }>(
      'POST',
      '/api/comments',
      {
        filePath: FILE,
        side: 'new',
        startLine: line,
        endLine: line,
        lineSnapshot: lines.slice(line - 1, line),
        body,
      }
    );
    expect(r.status).toBe(200);
    return r.body.comment;
  };
  const eventsSince = (n: number) =>
    tap
      .all()
      .slice(n)
      .filter((e) => EVENTS.includes(e.type));

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
    process.env['LOOKSEE_HOME'] = home;
    repo = await makeRepo();
    await seedRepo(repo);
    await featureBranchWithLayers(repo);
    srv = await startTestServer({ repoRoot: repo.dir });
    tap = await srv.events();
    await tap.next('hello');
    const plain = await seed('plain remark', 2);
    const sugg = await seed('```suggestion\nconst TAX = 0.2;\n```', 1);
    const gone = await seed('old news', 4);
    await srv.json('POST', '/api/comments', {
      parentId: plain.id,
      body: 'a reply',
    });
    await srv.json('PATCH', `/api/comments/${gone.id}`, {
      status: 'resolved',
    });
    ids['plain'] = plain.id;
    ids['sugg'] = sugg.id;
    ids['gone'] = gone.id;
  });
  afterAll(async () => {
    tap.close();
    await srv.close();
    await repo.cleanup();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('comments lists open roots with replies nested and expects', async () => {
    const r = await cli(['comments']);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    const threads = json<Thread[]>(r.out);
    expect(threads.map((t) => t.id).sort()).toEqual(
      [ids['plain'], ids['sugg']].sort()
    );
    for (const t of threads) {
      expect(t.filePath).toBe(FILE);
      expect(t.startLine).toBeGreaterThan(0);
      expect(t.lineSnapshot).toHaveLength(1);
      expect(t.bodyHtml).toContain('<');
      expect(t).toHaveProperty('suggestion');
    }
    const plain = threads.find((t) => t.id === ids['plain'])!;
    const sugg = threads.find((t) => t.id === ids['sugg'])!;
    expect(plain.expects).toBe('fix and reply');
    expect(plain.replies.map((x) => x.body)).toEqual(['a reply']);
    expect(sugg.expects).toBe('apply or reply');
    expect(sugg.suggestion?.lines).toEqual(['const TAX = 0.2;']);
    expect(sugg.replies).toEqual([]);
  });

  it('comments --status resolved returns the resolved thread', async () => {
    const r = await cli(['comments', '--status', 'resolved']);
    expect(r.code).toBe(0);
    const threads = json<Thread[]>(r.out);
    expect(threads.map((t) => t.id)).toEqual([ids['gone']]);
  });

  it('comments --file and --author filter, --pretty prints a table', async () => {
    const none = await cli(['comments', '--file', 'README.md']);
    expect(json<Thread[]>(none.out)).toEqual([]);
    const mine = await cli(['comments', '--author', 'user']);
    expect(json<Thread[]>(mine.out)).toHaveLength(2);
    const pretty = await cli(['comments', '--pretty']);
    expect(pretty.code).toBe(0);
    expect(() => JSON.parse(pretty.out)).toThrow();
    expect(pretty.out).toContain('expects');
  });

  it('AE8: reply with LOOKSEE_ACTOR=bot stores author bot and emits', async () => {
    const mark = tap.all().length;
    const r = await cli(['reply', ids['sugg']!, 'on it'], {
      LOOKSEE_ACTOR: 'bot',
    });
    expect(r.code).toBe(0);
    const reply = json<DecoratedComment>(r.out);
    expect(reply.parentId).toBe(ids['sugg']);
    expect(reply.author).toBe('bot');
    expect(reply.body).toBe('on it');
    const ev = await tap.next('comment.replied');
    expect(ev.type === 'comment.replied' && ev.comment.id).toBe(reply.id);
    expect(eventsSince(mark).map((e) => e.type)).toEqual(['comment.replied']);
  });

  it('reply reads the body from stdin when the argument is absent', async () => {
    const r = await cli(['reply', ids['plain']!], {}, 'from stdin\n');
    expect(r.code).toBe(0);
    const reply = json<DecoratedComment>(r.out);
    expect(reply.body).toBe('from stdin');
    expect(reply.author).toBe('agent');
  });

  it('AE9: reply on a bad id exits 1 with one stderr line and no stdout', async () => {
    const r = await cli(['reply', 'nope', 'x']);
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err.endsWith('\n')).toBe(true);
    expect(r.err.trim().split('\n')).toHaveLength(1);
  });

  it('resolve sets resolved and a second resolve still exits 0', async () => {
    const mark = tap.all().length;
    const first = await cli(['resolve', ids['plain']!]);
    expect(first.code).toBe(0);
    expect(json<DecoratedComment>(first.out).status).toBe('resolved');
    const ev = await tap.next('thread.resolved');
    expect(ev.type === 'thread.resolved' && ev.id).toBe(ids['plain']);
    const again = await cli(['resolve', ids['plain']!]);
    expect(again.code).toBe(0);
    expect(again.err).toBe('');
    expect(json<DecoratedComment>(again.out).status).toBe('resolved');
    await settle();
    expect(eventsSince(mark).map((e) => e.type)).toEqual(['thread.resolved']);
  });

  it('comment posts a single comment with the current lines as snapshot', async () => {
    const lines = (await fs.readFile(path.join(repo.dir, FILE), 'utf8')).split(
      '\n'
    );
    const r = await cli(['comment', `${FILE}:3-4`, 'tighten this']);
    expect(r.code).toBe(0);
    const c = json<DecoratedComment>(r.out);
    expect(c.filePath).toBe(FILE);
    expect(c.side).toBe('new');
    expect(c.startLine).toBe(3);
    expect(c.endLine).toBe(4);
    expect(c.lineSnapshot).toEqual(lines.slice(2, 4));
    expect(c.reviewId).toBeNull();
    expect(c.parentId).toBeNull();
    expect(c.branch).toBe('feature/x');
    expect(c.body).toBe('tighten this');
    const ev = await tap.next('comment.created');
    expect(ev.type === 'comment.created' && ev.comment.id).toBe(c.id);
  });

  it('comment rejects a bad anchor and a missing file', async () => {
    const bad = await cli(['comment', 'src/cart.js', 'x']);
    expect(bad.code).toBe(1);
    expect(bad.out).toBe('');
    expect(bad.err).toMatch(/<file>:<line>/);
    const missing = await cli(['comment', 'src/nope.js:1', 'x']);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/src\/nope\.js/);
    const past = await cli(['comment', `${FILE}:9999`, 'x']);
    expect(past.code).toBe(1);
    expect(past.err).toMatch(/9999/);
    const eof = await cli(['comment', `${FILE}:41`, 'x']);
    expect(eof.code).toBe(1);
    expect(eof.err).toMatch(/40 lines, not 41/);
    const last = await cli(['comment', `${FILE}:40`, 'x']);
    expect(last.code).toBe(0);
    expect(json<DecoratedComment>(last.out).lineSnapshot).toEqual([
      '// line 40',
    ]);
  });

  it('review comment without a pending review exits 1 with a hint', async () => {
    const r = await cli(['review', 'comment', `${FILE}:1`, 'x']);
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('run looksee review start first');
  });

  it('review start, comment, show, submit', async () => {
    const mark = tap.all().length;
    const started = await cli(['review', 'start']);
    expect(started.code).toBe(0);
    const review = json<Review>(started.out);
    expect(review.state).toBe('pending');
    expect(review.author).toBe('agent');
    expect(review.branch).toBe('feature/x');
    const a = await cli(['review', 'comment', `${FILE}:1`, 'draft one']);
    const b = await cli(['review', 'comment', `${FILE}:2-3`, 'draft two']);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(json<DecoratedComment>(a.out).reviewId).toBe(review.id);
    const shown = await cli(['review', 'show']);
    expect(shown.code).toBe(0);
    const res = json<ReviewRes>(shown.out);
    expect(res.review.id).toBe(review.id);
    expect(res.comments.map((c) => c.body).sort()).toEqual([
      'draft one',
      'draft two',
    ]);
    const hidden = await cli(['comments']);
    expect(
      json<Thread[]>(hidden.out).some((t) => t.reviewId === review.id)
    ).toBe(false);
    await settle();
    expect(eventsSince(mark)).toEqual([]);
    const submitted = await cli([
      'review',
      'submit',
      '--verdict',
      'approve',
      'looks good',
    ]);
    expect(submitted.code).toBe(0);
    const out = json<ReviewRes>(submitted.out);
    expect(out.review.state).toBe('submitted');
    expect(out.review.verdict).toBe('approve');
    expect(out.review.body).toBe('looks good');
    expect(out.comments).toHaveLength(2);
    const ev = await tap.next('review.submitted');
    expect(ev.type === 'review.submitted' && ev.review.verdict).toBe('approve');
    expect(eventsSince(mark).map((e) => e.type)).toEqual(['review.submitted']);
  });

  it('review submit needs a verdict, review discard drops drafts', async () => {
    const started = await cli(['review', 'start']);
    expect(started.code).toBe(0);
    const again = await cli(['review', 'start']);
    expect(again.code).toBe(1);
    expect(again.out).toBe('');
    const noVerdict = await cli(['review', 'submit']);
    expect(noVerdict.code).toBe(1);
    expect(noVerdict.err).toMatch(/verdict/);
    await cli(['review', 'comment', `${FILE}:5`, 'to drop']);
    const discarded = await cli(['review', 'discard']);
    expect(discarded.code).toBe(0);
    expect(json<{ ok: boolean }>(discarded.out)).toEqual({ ok: true });
    const shown = await cli(['review', 'show']);
    expect(shown.code).toBe(1);
    expect(shown.err).toContain('run looksee review start first');
  });

  it('pin resets approvedAt and reports the new comparison', async () => {
    const started = await srv.json<{ review: Review }>('POST', '/api/reviews');
    await srv.json('POST', `/api/reviews/${started.body.review.id}/submit`, {
      verdict: 'approve',
    });
    const before = (await srv.json<Session>('GET', '/api/session')).body;
    expect(before.approvedAt).not.toBeNull();
    const r = await cli(['pin']);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    const out = json<{ openedAt: string; approvedAt: null; label: string }>(
      r.out
    );
    expect(out.openedAt).toMatch(SHORT);
    expect(out.approvedAt).toBeNull();
    expect(out.label).toContain(out.openedAt);
    const after = (await srv.json<Session>('GET', '/api/session')).body;
    expect(after.approvedAt).toBeNull();
    expect(after.openedAt?.head.slice(0, 7)).toBe(out.openedAt);
    expect(after.openedAt?.at).not.toBe(before.openedAt?.at);
  });

  it('scope working switches and bare scope prints the comparison', async () => {
    const set = await cli(['scope', 'working']);
    expect(set.code).toBe(0);
    expect(json<ResolvedComparison>(set.out).preset).toBe('working');
    const get = await cli(['scope']);
    expect(get.code).toBe(0);
    const cmp = json<ResolvedComparison>(get.out);
    expect(cmp.preset).toBe('working');
    expect(cmp.baseline.kind).toBe('head');
    expect(cmp.endpoint.kind).toBe('worktree');
    const state = (await srv.json<RepoState>('GET', '/api/state')).body;
    expect(state.comparison?.preset).toBe('working');
    const custom = await cli(['scope', 'custom']);
    expect(custom.code).toBe(1);
    expect(custom.out).toBe('');
    expect(custom.err).toMatch(/browser/);
    const bad = await cli(['scope', 'nope']);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/session\|working\|branch/);
  });

  it('status reports scope and both pins', async () => {
    const r = await cli(['status']);
    expect(r.code).toBe(0);
    const st = json<Status>(r.out);
    expect(st.running).toBe(true);
    expect(st.url).toBe(srv.base);
    expect(st.scope).toBe('working');
    expect(st.openedAt).toMatch(SHORT);
    expect(st.approvedAt).toBeNull();
    expect(st.drift).toBe(false);
    expect((await cli(['status', '--help'])).out).toContain('openedAt');
  });

  it('session end clears the session and a new server start creates one', async () => {
    const end = await cli(['session', 'end']);
    expect(end.code).toBe(0);
    expect(json<{ ended: boolean }>(end.out)).toEqual({ ended: true });
    const st = json<Status>((await cli(['status'])).out);
    expect(st.running).toBe(true);
    expect(st.scope).toBeNull();
    expect(st.openedAt).toBeNull();
    expect(st.approvedAt).toBeNull();
    const again = await cli(['session', 'end']);
    expect(again.code).toBe(0);
    expect(json<{ ended: boolean }>(again.out)).toEqual({ ended: false });
    const next = await startTestServer({ repoRoot: repo.dir });
    try {
      const s = (await next.json<Session>('GET', '/api/session')).body;
      expect(s.endedAt).toBeNull();
      expect(s.openedAt).not.toBeNull();
      const fresh = json<Status>(
        (await cli(['status'], { LOOKSEE_URL: next.base })).out
      );
      expect(fresh.scope).toBe('session');
      expect(fresh.openedAt).toBe(s.openedAt?.head.slice(0, 7));
    } finally {
      await next.close();
    }
  });

  it('every command help names its output shape', async () => {
    const names = [
      ['comments'],
      ['reply'],
      ['resolve'],
      ['comment'],
      ['pin'],
      ['scope'],
      ['session', 'end'],
      ['status'],
      ['review', 'start'],
      ['review', 'comment'],
      ['review', 'submit'],
      ['review', 'discard'],
      ['review', 'show'],
    ];
    for (const n of names) {
      const r = await cli([...n, '--help']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('Output:');
    }
  });
});
