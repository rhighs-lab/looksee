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
import type {
  DecoratedComment,
  DoneMark,
  Review,
  ServerEvent,
} from '@/shared/protocol.js';

type CommentRes = { comment: DecoratedComment };
type ReviewRes = { review: Review; comments: DecoratedComment[] };
type ListRes = { comments: DecoratedComment[] };
const FILE = 'src/cart.js';
const fence = (lines: string[]) =>
  `\`\`\`suggestion\n${lines.join('\n')}${lines.length ? '\n' : ''}\`\`\``;
const COMMENT_EVENTS: ServerEvent['type'][] = [
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'comment.replied',
  'review.submitted',
  'thread.resolved',
  'thread.reopened',
];
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('reviews API', () => {
  let repo: Repo;
  let srv: TestServer;
  let home: string;
  let tap: EventTap;
  const as = (actor?: string) =>
    actor ? { 'x-looksee-actor': actor } : undefined;
  const fileLines = async () =>
    (await fs.readFile(path.join(repo.dir, FILE), 'utf8')).split('\n');
  const post = (payload: unknown, actor?: string) =>
    srv.json<CommentRes>('POST', '/api/comments', payload, as(actor));
  const patch = (id: string, b: unknown, actor?: string) =>
    srv.json<CommentRes>('PATCH', `/api/comments/${id}`, b, as(actor));
  const list = async (query = '', actor?: string) =>
    (
      await srv.json<ListRes>(
        'GET',
        `/api/comments${query}`,
        undefined,
        as(actor)
      )
    ).body.comments;
  const start = (actor?: string) =>
    srv.json<{ review: Review }>('POST', '/api/reviews', {}, as(actor));
  const submit = (id: string, b: unknown, actor?: string) =>
    srv.json<ReviewRes>('POST', `/api/reviews/${id}/submit`, b, as(actor));
  const draft = async (
    reviewId: string,
    startLine: number,
    body: string,
    actor?: string
  ) => {
    const all = await fileLines();
    const r = await post(
      {
        filePath: FILE,
        side: 'new',
        startLine,
        endLine: startLine,
        lineSnapshot: all.slice(startLine - 1, startLine),
        body,
        reviewId,
      },
      actor
    );
    expect(r.status).toBe(200);
    return r.body.comment;
  };
  const eventsSince = (n: number) =>
    tap
      .all()
      .slice(n)
      .filter((e) => COMMENT_EVENTS.includes(e.type));

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-home-'));
    process.env['LOOKSEE_HOME'] = home;
    repo = await makeRepo();
    await seedRepo(repo);
    await featureBranchWithLayers(repo);
    srv = await startTestServer({ repoRoot: repo.dir });
    tap = await srv.events();
    await tap.next('hello');
  });
  afterAll(async () => {
    tap.close();
    await srv.close();
    await repo.cleanup();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('AE1: draft edits emit nothing and stay hidden from other actors', async () => {
    const mark = tap.all().length;
    const { body } = await start();
    const a = await draft(body.review.id, 2, 'first');
    const b = await draft(body.review.id, 4, 'second');
    expect(a.reviewId).toBe(body.review.id);
    const edited = await patch(a.id, { body: 'first edited' });
    expect(edited.status).toBe(200);
    expect(edited.body.comment.body).toBe('first edited');
    const asReviewer = await list('', 'reviewer');
    expect(asReviewer.some((c) => c.id === a.id || c.id === b.id)).toBe(false);
    const asOwner = await list();
    expect(asOwner.filter((c) => c.reviewId === body.review.id)).toHaveLength(
      2
    );
    const shown = await srv.json<ReviewRes>(
      'GET',
      `/api/reviews/${body.review.id}`
    );
    expect(shown.body.comments.map((c) => c.id).sort()).toEqual(
      [a.id, b.id].sort()
    );
    expect(
      (
        await srv.json(
          'GET',
          `/api/reviews/${body.review.id}`,
          undefined,
          as('reviewer')
        )
      ).status
    ).toBe(403);
    await settle();
    expect(eventsSince(mark)).toEqual([]);
    expect(
      (await srv.json('DELETE', `/api/reviews/${body.review.id}`)).status
    ).toBe(200);
  });

  it('AE2: submit emits one review.submitted with decorated comments', async () => {
    const mark = tap.all().length;
    const { body } = await start();
    const all = await fileLines();
    const a = await draft(
      body.review.id,
      6,
      `fix this\n\n${fence(['// six'])}`
    );
    const b = await draft(body.review.id, 8, '@agent why?');
    expect((await submit(body.review.id, { verdict: 'nope' })).status).toBe(
      400
    );
    const r = await submit(body.review.id, {
      verdict: 'request_changes',
      body: 'please fix',
    });
    expect(r.status).toBe(200);
    expect(r.body.review).toMatchObject({
      state: 'submitted',
      verdict: 'request_changes',
      body: 'please fix',
      author: 'user',
    });
    const ev = await tap.next('review.submitted');
    if (ev.type !== 'review.submitted') throw new Error('wrong event');
    expect(ev.review.id).toBe(body.review.id);
    expect(ev.comments.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    const sug = ev.comments.find((c) => c.id === a.id)!;
    expect(sug.lineSnapshot).toEqual([all[5]]);
    expect(sug.suggestion).toEqual({ lines: ['// six'] });
    expect(sug.bodyHtml).toMatch(/suggestion-diff/);
    expect(ev.comments.find((c) => c.id === b.id)!.kind).toBe('question');
    await settle();
    expect(eventsSince(mark).map((e) => e.type)).toEqual(['review.submitted']);
    expect((await list('', 'reviewer')).some((c) => c.id === a.id)).toBe(true);
    expect((await submit(body.review.id, { verdict: 'approve' })).status).toBe(
      409
    );
    expect(
      (await srv.json('DELETE', `/api/reviews/${body.review.id}`)).status
    ).toBe(409);
    const submitted = await srv.json<{ reviews: Review[] }>(
      'GET',
      '/api/reviews?state=submitted'
    );
    expect(submitted.body.reviews.map((x) => x.id)).toContain(body.review.id);
  });

  it('AE3: a single comment without reviewId emits comment.created at once', async () => {
    const { body, status } = await post({
      filePath: 'README.md',
      side: 'file',
      body: 'single',
      reviewId: null,
    });
    expect(status).toBe(200);
    const ev = await tap.next('comment.created');
    expect(ev.type === 'comment.created' && ev.comment.id).toBe(
      body.comment.id
    );
  });

  it('rejects adding a comment to another actor’s pending review', async () => {
    const { body } = await start('reviewer');
    const r = await post(
      {
        filePath: 'README.md',
        side: 'file',
        body: 'x',
        reviewId: body.review.id,
      },
      'agent'
    );
    expect(r.status).toBe(403);
    expect(
      (
        await srv.json(
          'DELETE',
          `/api/reviews/${body.review.id}`,
          undefined,
          as('agent')
        )
      ).status
    ).toBe(403);
    expect(
      (
        await srv.json(
          'DELETE',
          `/api/reviews/${body.review.id}`,
          undefined,
          as('reviewer')
        )
      ).status
    ).toBe(200);
  });

  it('keeps submitted bodies immutable but still resolves and reopens', async () => {
    const mark = tap.all().length;
    const { body } = await start('reviewer');
    const c = await draft(body.review.id, 10, 'immutable', 'reviewer');
    await submit(body.review.id, { verdict: 'comment' }, 'reviewer');
    await tap.next('review.submitted');
    expect((await patch(c.id, { body: 'changed' }, 'reviewer')).status).toBe(
      409
    );
    const single = (
      await post({ filePath: 'README.md', side: 'file', body: 'one-off' })
    ).body.comment;
    expect((await patch(single.id, { body: 'changed' })).status).toBe(409);
    const resolved = await patch(c.id, { status: 'resolved' }, 'agent');
    expect(resolved.status).toBe(200);
    expect(resolved.body.comment.status).toBe('resolved');
    const ev = await tap.next('thread.resolved');
    expect(ev).toMatchObject({
      type: 'thread.resolved',
      id: c.id,
      actor: 'agent',
    });
    await patch(c.id, { status: 'open' });
    const re = await tap.next('thread.reopened');
    expect(re).toMatchObject({
      type: 'thread.reopened',
      id: c.id,
      actor: 'user',
    });
    expect(eventsSince(mark).map((e) => e.type)).toEqual([
      'review.submitted',
      'comment.created',
      'thread.resolved',
      'thread.reopened',
    ]);
  });

  it('emits comment.replied for replies, never comment.created', async () => {
    const mark = tap.all().length;
    const root = (
      await post({ filePath: 'README.md', side: 'file', body: 'root' })
    ).body.comment;
    await tap.next('comment.created');
    const reply = await post({ parentId: root.id, body: 'reply' }, 'agent');
    expect(reply.status).toBe(200);
    expect(reply.body.comment).toMatchObject({
      author: 'agent',
      parentId: root.id,
      reviewId: null,
    });
    const ev = await tap.next('comment.replied');
    expect(ev.type === 'comment.replied' && ev.comment.id).toBe(
      reply.body.comment.id
    );
    expect(
      (await patch(reply.body.comment.id, { body: 'x' }, 'agent')).status
    ).toBe(409);
    await settle();
    expect(eventsSince(mark).map((e) => e.type)).toEqual([
      'comment.created',
      'comment.replied',
    ]);
  });

  it('discards a review with its comments and emits nothing', async () => {
    const mark = tap.all().length;
    const { body } = await start();
    const c = await draft(body.review.id, 12, 'gone');
    const r = await srv.json<{ ok: boolean }>(
      'DELETE',
      `/api/reviews/${body.review.id}`
    );
    expect(r.status).toBe(200);
    expect((await list()).some((x) => x.id === c.id)).toBe(false);
    expect(
      (await srv.json('GET', `/api/reviews/${body.review.id}`)).status
    ).toBe(404);
    await settle();
    expect(eventsSince(mark)).toEqual([]);
  });

  it('refuses a second pending review for the same actor', async () => {
    const first = await start('bot');
    expect(first.status).toBe(200);
    const second = await srv.json<{ code: string; review: Review }>(
      'POST',
      '/api/reviews',
      {},
      as('bot')
    );
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('pending_review');
    expect(second.body.review.id).toBe(first.body.review.id);
    const pending = await srv.json<{ reviews: Review[] }>(
      'GET',
      '/api/reviews?state=pending'
    );
    expect(pending.body.reviews.map((x) => x.id)).toContain(
      first.body.review.id
    );
    await srv.json(
      'DELETE',
      `/api/reviews/${first.body.review.id}`,
      undefined,
      as('bot')
    );
  });

  it('AE7: done emits done.requested and is listed', async () => {
    const r = await srv.json<{ done: DoneMark }>(
      'POST',
      '/api/done',
      { body: 'round one addressed' },
      as('agent')
    );
    expect(r.status).toBe(200);
    expect(r.body.done).toMatchObject({
      actor: 'agent',
      body: 'round one addressed',
    });
    const ev = await tap.next('done.requested');
    expect(ev).toMatchObject({
      type: 'done.requested',
      actor: 'agent',
      body: 'round one addressed',
    });
    const all = await srv.json<{ done: DoneMark[] }>('GET', '/api/done');
    expect(all.body.done).toHaveLength(1);
    expect(all.body.done[0]!.at).toBe(r.body.done.at);
  });

  it('resolves the author from the actor header', async () => {
    const plain = (
      await post({ filePath: 'README.md', side: 'file', body: 'as user' })
    ).body.comment;
    expect(plain.author).toBe('user');
    const bot = (
      await post(
        { filePath: 'README.md', side: 'file', body: 'as bot', author: 'x' },
        'bot'
      )
    ).body.comment;
    expect(bot.author).toBe('bot');
    expect((await list('?author=bot')).map((c) => c.id)).toEqual([bot.id]);
    expect(
      (await post({ filePath: 'README.md', side: 'file', body: 'x' }, 'user'))
        .status
    ).toBe(400);
  });

  it('applies agent suggestions like user ones and skips foreign drafts', async () => {
    const all = await fileLines();
    const mine = (
      await post(
        {
          filePath: FILE,
          side: 'new',
          startLine: 20,
          endLine: 20,
          lineSnapshot: [all[19]],
          body: fence(['// by agent']),
        },
        'agent'
      )
    ).body.comment;
    await tap.next('comment.created');
    const { body } = await start('reviewer');
    const hidden = await draft(
      body.review.id,
      22,
      fence(['// hidden draft']),
      'reviewer'
    );
    expect(
      (await srv.json('POST', `/api/comments/${hidden.id}/apply`)).status
    ).toBe(404);
    const r = await srv.json<{ applied: DecoratedComment[] }>(
      'POST',
      '/api/suggestions/apply-all',
      undefined,
      as('reviewer')
    );
    const ids = r.body.applied.map((c) => c.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(hidden.id);
    const lines = await fileLines();
    expect(lines[19]).toBe('// by agent');
    expect(lines[21]).toBe(all[21]);
    await srv.json(
      'DELETE',
      `/api/reviews/${body.review.id}`,
      undefined,
      as('reviewer')
    );
  });
});
