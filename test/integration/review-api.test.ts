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
  DecoratedComment,
  DiffResponse,
  Review,
} from '@/shared/protocol.js';

type CommentRes = { comment: DecoratedComment };
const FILE = 'src/cart.js';
const fence = (lines: string[]) =>
  `\`\`\`suggestion\n${lines.join('\n')}${lines.length ? '\n' : ''}\`\`\``;

describe('review API', () => {
  let repo: Repo;
  let srv: TestServer;
  let home: string;
  const fileLines = async () =>
    (await fs.readFile(path.join(repo.dir, FILE), 'utf8')).split('\n');
  const post = (payload: unknown) =>
    srv.json<CommentRes>('POST', '/api/comments', payload);
  const patch = (id: string, b: unknown) =>
    srv.json<CommentRes>('PATCH', `/api/comments/${id}`, b);
  const get = async (id: string) =>
    (
      await srv.json<{ comments: DecoratedComment[] }>('GET', '/api/comments')
    ).body.comments.find((c) => c.id === id)!;
  const suggest = async (
    startLine: number,
    endLine: number,
    added: string[],
    extra: Record<string, unknown> = {}
  ) => {
    const all = await fileLines();
    return (
      await post({
        filePath: FILE,
        side: 'new',
        startLine,
        endLine,
        lineSnapshot: all.slice(startLine - 1, endLine),
        body: fence(added),
        ...extra,
      })
    ).body.comment;
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

  it('creates, lists, replies to and resolves comments', async () => {
    const { body } = await post({
      filePath: 'README.md',
      side: 'new',
      startLine: 3,
      endLine: 3,
      body: 'Plain comment',
      branch: 'feature/x',
      lineSnapshot: ['more'],
    });
    expect(body.comment).toMatchObject({
      kind: 'comment',
      status: 'open',
      suggestion: null,
      applicable: null,
      reviewId: null,
      applied: null,
    });
    const reply = await srv.json<CommentRes>(
      'POST',
      '/api/comments',
      { parentId: body.comment.id, body: 'ack' },
      { 'x-looksee-actor': 'agent' }
    );
    expect(reply.body.comment).toMatchObject({
      parentId: body.comment.id,
      author: 'agent',
      filePath: 'README.md',
      startLine: 3,
    });
    expect(
      (await post({ parentId: reply.body.comment.id, body: 'nested' })).status
    ).toBe(400);
    const resolved = await patch(body.comment.id, { status: 'resolved' });
    expect(resolved.body.comment.status).toBe('resolved');
    const open = await srv.json<{ comments: DecoratedComment[] }>(
      'GET',
      '/api/comments?status=open&author=user&roots=1'
    );
    expect(open.body.comments.some((c) => c.id === body.comment.id)).toBe(
      false
    );
    const branchOnly = await srv.json<{ comments: DecoratedComment[] }>(
      'GET',
      '/api/comments?branch=feature/x'
    );
    expect(
      branchOnly.body.comments.every((c) => c.branch === 'feature/x')
    ).toBe(true);
  });

  it('escapes raw HTML and strips javascript: links in rendered bodies', async () => {
    const { body } = await post({
      filePath: 'README.md',
      side: 'file',
      body: '<script>alert(1)</script>\n\n[a](javascript:alert(1)) [ok](https://e.com) ![p](/attachments/x.png)',
    });
    expect(body.comment.bodyHtml).not.toMatch(/<script>/);
    expect(body.comment.bodyHtml).not.toMatch(/javascript/i);
    expect(body.comment.bodyHtml).toMatch(/<a href="https:\/\/e\.com">ok<\/a>/);
    expect(body.comment.bodyHtml).toMatch(/<img src="\/attachments\/x\.png"/);
  });

  it('renders @agent mentions as questions and edits drafts in place', async () => {
    const rv = await srv.json<{ review: Review }>('POST', '/api/reviews', {});
    const { body } = await post({
      filePath: 'README.md',
      side: 'file',
      body: 'first draft\n\n@agent ok?',
      reviewId: rv.body.review.id,
    });
    expect(body.comment.kind).toBe('question');
    expect(body.comment.bodyHtml).toMatch(/mention-agent/);
    await patch(body.comment.id, { body: 'second draft' });
    expect((await get(body.comment.id)).body).toBe('second draft');
    await srv.json('DELETE', `/api/reviews/${rv.body.review.id}`);
    expect(await get(body.comment.id)).toBeUndefined();
  });

  it('applies a suggestion, resolves it, and reports outdated ones', async () => {
    const before = await fileLines();
    const c = await suggest(20, 20, ['// applied 20']);
    expect(c.kind).toBe('suggestion');
    expect(c.applicable).toBe(true);
    const res = await srv.json<CommentRes>(
      'POST',
      `/api/comments/${c.id}/apply`
    );
    expect(res.status).toBe(200);
    expect(res.body.comment.status).toBe('resolved');
    expect(res.body.comment.applied?.lines).toEqual(['// applied 20']);
    const after = await fileLines();
    expect(after[19]).toBe('// applied 20');
    expect(after.length).toBe(before.length);
    expect((await srv.json('POST', `/api/comments/${c.id}/apply`)).status).toBe(
      409
    );

    const stale = await suggest(25, 25, ['// stale']);
    await repo.write(
      FILE,
      (await fileLines()).map((l, i) => (i === 24 ? '// moved' : l)).join('\n')
    );
    expect((await get(stale.id)).applicable).toBe(false);
    const r = await srv.json<{ outdated: boolean }>(
      'POST',
      `/api/comments/${stale.id}/apply`
    );
    expect(r.status).toBe(409);
    expect(r.body.outdated).toBe(true);
  });

  it('rejects apply for old-side, foreign-draft and missing-file comments', async () => {
    const old = (
      await post({
        filePath: FILE,
        side: 'old',
        startLine: 1,
        endLine: 1,
        lineSnapshot: ['x'],
        body: fence(['y']),
      })
    ).body.comment;
    expect(old.kind).toBe('comment');
    expect(
      (await srv.json('POST', `/api/comments/${old.id}/apply`)).status
    ).toBe(400);
    const rv = await srv.json<{ review: Review }>(
      'POST',
      '/api/reviews',
      {},
      { 'x-looksee-actor': 'reviewer' }
    );
    const all = await fileLines();
    const foreign = await srv.json<CommentRes>(
      'POST',
      '/api/comments',
      {
        filePath: FILE,
        side: 'new',
        startLine: 30,
        endLine: 30,
        lineSnapshot: all.slice(29, 30),
        body: fence(['// draft']),
        reviewId: rv.body.review.id,
      },
      { 'x-looksee-actor': 'reviewer' }
    );
    expect(
      (await srv.json('POST', `/api/comments/${foreign.body.comment.id}/apply`))
        .status
    ).toBe(404);
    await repo.write('src/gone.js', 'a\nb\n');
    const gone = (
      await post({
        filePath: 'src/gone.js',
        side: 'new',
        startLine: 1,
        endLine: 1,
        lineSnapshot: ['a'],
        body: fence(['z']),
      })
    ).body.comment;
    await repo.rm('src/gone.js');
    expect(
      (await srv.json('POST', `/api/comments/${gone.id}/apply`)).status
    ).toBe(409);
  });

  it('applies all bottom-up and preserves file mode', async () => {
    const a = await suggest(34, 34, ['// a1', '// a2']);
    const b = await suggest(36, 36, ['// b']);
    const r = await srv.json<{
      applied: DecoratedComment[];
      skipped: unknown[];
    }>('POST', '/api/suggestions/apply-all');
    expect(r.body.applied.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    const lines = await fileLines();
    expect(lines[33]).toBe('// a1');
    expect(lines[34]).toBe('// a2');
    expect(lines[36]).toBe('// b');
    const p = path.join(repo.dir, 'src', 'run.sh');
    await fs.writeFile(p, '#!/bin/sh\necho one\n', { mode: 0o755 });
    const sh = (
      await post({
        filePath: 'src/run.sh',
        side: 'new',
        startLine: 2,
        endLine: 2,
        lineSnapshot: ['echo one'],
        body: fence(['echo two']),
      })
    ).body.comment;
    expect(
      (await srv.json('POST', `/api/comments/${sh.id}/apply`)).status
    ).toBe(200);
    expect((await fs.stat(p)).mode & 0o777).toBe(0o755);
  });

  it('previews markdown with an anchored suggestion mini diff', async () => {
    const all = await fileLines();
    const r = await srv.json<{ html: string }>('POST', '/api/preview', {
      body: fence(['changed']),
      filePath: FILE,
      side: 'new',
      startLine: 2,
      endLine: 2,
    });
    expect(r.body.html).toMatch(/suggestion-diff/);
    expect(r.body.html).toContain(all[1]);
    const plain = await srv.json<{ html: string }>('POST', '/api/preview', {
      body: '**b**',
    });
    expect(plain.body.html).toMatch(/<strong>b<\/strong>/);
  });

  it('exports markdown and json with suggestion metadata', async () => {
    const q = (
      await post({
        filePath: 'README.md',
        side: 'new',
        startLine: 1,
        lineSnapshot: ['# fixture'],
        body: '@agent why?',
      })
    ).body.comment;
    const md = await srv.json<{ count: number; content: string; path: string }>(
      'POST',
      '/api/export',
      { format: 'md' }
    );
    expect(md.body.count).toBeGreaterThan(0);
    expect(md.body.content).toMatch(/Question for the agent/);
    expect(md.body.content).toMatch(/Already applied\./);
    expect(md.body.content).toMatch(/Outdated: the lines changed/);
    expect(md.body.content).toContain(`<!-- looksee:id ${q.id} -->`);
    expect(md.body.content).toMatch(/^# Review/);
    expect(md.body.content).toMatch(/## Working through this review/);
    expect(md.body.content).toContain(`looksee reply ${q.id}`);
    expect(md.body.content).toMatch(/## Contents/);
    await fs.access(path.join(repo.dir, md.body.path));
    const json = await srv.json<{ content: string }>('POST', '/api/export', {
      format: 'json',
    });
    const parsed = JSON.parse(json.body.content) as Array<{
      kind: string;
      applied: boolean;
    }>;
    expect(parsed.some((c) => c.kind === 'suggestion' && c.applied)).toBe(true);
    expect(
      await fs.readFile(path.join(repo.dir, '.git', 'info', 'exclude'), 'utf8')
    ).toMatch(/\.looksee\//);
  });

  it('stores and deletes saved replies', async () => {
    const r = await srv.json<{ reply: { id: string } }>(
      'POST',
      '/api/saved-replies',
      { name: 'LGTM', body: 'Looks good.' }
    );
    expect(r.status).toBe(200);
    const list = await srv.json<{ replies: unknown[] }>(
      'GET',
      '/api/saved-replies'
    );
    expect(list.body.replies).toHaveLength(1);
    expect(
      (await srv.json('POST', '/api/saved-replies', { name: '', body: 'x' }))
        .status
    ).toBe(400);
    expect(
      (await srv.json('DELETE', `/api/saved-replies/${r.body.reply.id}`)).status
    ).toBe(200);
    expect(
      (await srv.json('DELETE', `/api/saved-replies/${r.body.reply.id}`)).status
    ).toBe(404);
  });

  it('accepts real images and rejects fakes', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );
    const ok = await srv.json<{ url: string; path: string }>(
      'POST',
      '/api/attachments',
      { name: 'shot.png', type: 'image/png', data: png.toString('base64') }
    );
    expect(ok.status).toBe(200);
    expect(ok.body.url).toMatch(/^\/attachments\/[a-f0-9]{16}\.png$/);
    const served = await fetch(srv.base + ok.body.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    const fake = await srv.json('POST', '/api/attachments', {
      name: 'x.png',
      type: 'image/png',
      data: Buffer.from('not png').toString('base64'),
    });
    expect(fake.status).toBe(400);
    expect(
      (await fetch(`${srv.base}/attachments/../../etc/passwd`)).status
    ).toBe(404);
  });

  it('clears and restores comments, and broadcasts comment events', async () => {
    const tap = await srv.events();
    await tap.next('hello');
    const c = (
      await post({ filePath: 'README.md', side: 'file', body: 'event me' })
    ).body.comment;
    const ev = await tap.next('comment.created');
    expect(ev.type === 'comment.created' && ev.comment.id).toBe(c.id);
    const cleared = await srv.json<{ cleared: number }>(
      'POST',
      '/api/comments/clear',
      {}
    );
    expect(cleared.body.cleared).toBeGreaterThan(0);
    await tap.next('comments.reset');
    expect(
      (await srv.json<{ comments: unknown[] }>('GET', '/api/comments')).body
        .comments
    ).toHaveLength(0);
    const restored = await srv.json<{ restored: number }>(
      'POST',
      '/api/comments/restore'
    );
    expect(restored.body.restored).toBe(cleared.body.cleared);
    tap.close();
  });

  it('re-renders a single file diff after an apply via the diff endpoint', async () => {
    const c = await suggest(38, 38, ['// via diff endpoint']);
    await srv.json('POST', `/api/comments/${c.id}/apply`);
    const { body } = await srv.json<DiffResponse>(
      'GET',
      `/api/diff?path=${FILE}`
    );
    expect(body.files).toHaveLength(1);
    expect(
      body.files[0]!.hunks.some((h) =>
        h.lines.some((l) => l.content === '// via diff endpoint')
      )
    ).toBe(true);
  });
});
