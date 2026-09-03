import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from '@/server/context.js';
import { getBlobLines } from '@/server/git/blobs.js';
import { safeRelPath } from '@/server/git/paths.js';
import {
  ATTACHMENT_NAME,
  attachmentsDir,
  ensureExcluded,
  MAX_ATTACHMENT_BYTES,
  saveAttachment,
} from '@/server/review/attachments.js';
import { applySuggestion, decorator } from '@/server/review/decorate.js';
import { buildJson, buildMarkdown } from '@/server/review/export.js';
import {
  isSuggestionRoot,
  renderCommentHtml,
  renderMarkdown,
} from '@/server/review/markdown.js';
import {
  addSavedReply,
  deleteSavedReply,
  listSavedReplies,
} from '@/server/review/saved-replies.js';
import {
  addComment,
  clearComments,
  deleteComment,
  getComment,
  listComments,
  restoreCleared,
  updateComment,
} from '@/server/review/store.js';
import { parseSuggestions } from '@/server/review/suggestion.js';
import type {
  Comment,
  CommentSide,
  DecoratedComment,
  ServerEvent,
} from '@/shared/protocol.js';

type Json = Record<string, unknown>;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function reviewRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const repoRoot = ctx.repoRoot;

  const emit = (
    ev: Exclude<ServerEvent, { type: 'hello' | 'state.changed' }>
  ) => ctx.hub.emit(ev);
  const originOf = (c: { req: { header(n: string): string | undefined } }) =>
    c.req.header('x-looksee-client') ?? null;
  const body = async (c: {
    req: { json(): Promise<unknown> };
  }): Promise<Json> => {
    try {
      const b = await c.req.json();
      return b && typeof b === 'object' ? (b as Json) : {};
    } catch {
      return {};
    }
  };

  app.post('/api/preview', async (c) => {
    const b = await body(c);
    if (typeof b['body'] !== 'string')
      return c.json({ error: 'bad params' }, 400);
    const text = b['body'];
    const start = Number(b['startLine']);
    const end = Number.isFinite(Number(b['endLine']))
      ? Number(b['endLine'])
      : start;
    const filePath = safeRelPath(b['filePath']);
    const anchored =
      repoRoot && b['side'] === 'new' && filePath && Number.isFinite(start);
    if (!anchored) return c.json({ html: renderMarkdown(text) });
    const { lines } = await getBlobLines(
      repoRoot,
      'WORKTREE',
      filePath,
      start,
      end
    );
    return c.json({
      html: renderCommentHtml(
        { body: text, side: 'new', parentId: null },
        { snapshot: lines, applicable: true }
      ),
    });
  });

  app.get('/api/comments', async (c) => {
    if (!repoRoot) return c.json({ comments: [] });
    const branch = c.req.query('branch') || null;
    const status = c.req.query('status');
    const author = c.req.query('author');
    const rootsOnly = c.req.query('roots') === '1';
    let comments = await listComments(repoRoot, branch);
    if (status === 'open' || status === 'resolved')
      comments = comments.filter((x) => x.status === status);
    if (author === 'user' || author === 'claude')
      comments = comments.filter((x) => x.author === author);
    if (rootsOnly) comments = comments.filter((x) => !x.parentId);
    const decorate = decorator(repoRoot);
    return c.json({ comments: await Promise.all(comments.map(decorate)) });
  });

  app.post('/api/comments', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const b = await body(c);
    const author = b['author'] === 'claude' ? 'claude' : 'user';
    if (b['parentId']) {
      const parent = await getComment(repoRoot, String(b['parentId']));
      if (!parent) return c.json({ error: 'parent not found' }, 404);
      if (parent.parentId)
        return c.json({ error: 'cannot reply to a reply' }, 400);
      if (typeof b['body'] !== 'string' || !b['body'])
        return c.json({ error: 'bad params' }, 400);
      const reply = await addComment(repoRoot, {
        parentId: parent.id,
        author,
        filePath: parent.filePath,
        side: parent.side,
        startLine: parent.startLine,
        endLine: parent.endLine,
        body: b['body'],
        branch: parent.branch,
        lineSnapshot: [],
      });
      const out = await decorator(repoRoot)(reply);
      emit({ type: 'comment.created', comment: out, origin: originOf(c) });
      return c.json({ comment: out });
    }
    const side: CommentSide =
      b['side'] === 'old' ? 'old' : b['side'] === 'file' ? 'file' : 'new';
    const startLine = side === 'file' ? 0 : Number(b['startLine']);
    const filePath = safeRelPath(b['filePath']);
    if (
      !filePath ||
      typeof b['body'] !== 'string' ||
      !b['body'] ||
      (side !== 'file' && !Number.isFinite(startLine))
    ) {
      return c.json({ error: 'bad params' }, 400);
    }
    const snapshot = Array.isArray(b['lineSnapshot'])
      ? (b['lineSnapshot'] as unknown[]).map(String)
      : [];
    const comment = await addComment(repoRoot, {
      parentId: null,
      author,
      filePath,
      side,
      startLine,
      endLine:
        side === 'file'
          ? 0
          : Number.isFinite(Number(b['endLine']))
            ? Number(b['endLine'])
            : startLine,
      body: b['body'],
      branch:
        typeof b['branch'] === 'string' && b['branch'] ? b['branch'] : null,
      lineSnapshot: snapshot,
    });
    const out = await decorator(repoRoot)(comment);
    emit({ type: 'comment.created', comment: out, origin: originOf(c) });
    return c.json({ comment: out });
  });

  app.patch('/api/comments/:id', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const b = await body(c);
    const id = c.req.param('id');
    const patch: Partial<Pick<Comment, 'body' | 'status' | 'handoff'>> = {};
    if (typeof b['body'] === 'string') patch.body = b['body'];
    if (b['status'] === 'open' || b['status'] === 'resolved')
      patch.status = b['status'];
    if (b['handoff'] === 'agent' || b['handoff'] === null)
      patch.handoff = b['handoff'];
    const comment = await updateComment(repoRoot, id, patch);
    if (!comment) return c.json({ error: 'not found' }, 404);
    const out = await decorator(repoRoot)(comment);
    emit({ type: 'comment.updated', comment: out, origin: originOf(c) });
    return c.json({ comment: out });
  });

  app.delete('/api/comments/:id', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const removed = await deleteComment(repoRoot, c.req.param('id'));
    if (removed)
      emit({
        type: 'comment.deleted',
        id: c.req.param('id'),
        origin: originOf(c),
      });
    return c.json({ ok: Boolean(removed), removed });
  });

  app.post('/api/comments/:id/apply', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const r = await applySuggestion(repoRoot, c.req.param('id'));
    if (r.status !== 200)
      return c.json(
        { error: r.error, ...(r.outdated ? { outdated: true } : {}) },
        r.status
      );
    const out = await decorator(repoRoot)(r.comment);
    emit({ type: 'comment.updated', comment: out, origin: originOf(c) });
    emit({ type: 'diff.changed', path: r.path, origin: originOf(c) });
    ctx.watcher?.schedule();
    return c.json({ comment: out });
  });

  app.post('/api/suggestions/apply-all', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const branch = c.req.query('branch') || null;
    const all = await listComments(repoRoot, branch);
    const candidates = all
      .filter(
        (x) =>
          isSuggestionRoot(x) &&
          x.status === 'open' &&
          x.handoff !== 'agent' &&
          parseSuggestions(x.body).length > 0
      )
      .sort((a, b) =>
        a.filePath < b.filePath
          ? -1
          : a.filePath > b.filePath
            ? 1
            : b.startLine - a.startLine
      );
    const applied: DecoratedComment[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const changed = new Set<string>();
    for (const x of candidates) {
      const r = await applySuggestion(repoRoot, x.id);
      if (r.status !== 200) {
        skipped.push({ id: x.id, reason: r.outdated ? 'outdated' : r.error });
        continue;
      }
      const out = await decorator(repoRoot)(r.comment);
      applied.push(out);
      changed.add(r.path);
      emit({ type: 'comment.updated', comment: out, origin: originOf(c) });
    }
    for (const p of changed)
      emit({ type: 'diff.changed', path: p, origin: originOf(c) });
    if (changed.size) ctx.watcher?.schedule();
    return c.json({ applied, skipped });
  });

  app.post('/api/comments/clear', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const b = await body(c);
    const cleared = await clearComments(
      repoRoot,
      typeof b['branch'] === 'string' && b['branch'] ? b['branch'] : null
    );
    emit({ type: 'comments.reset', origin: originOf(c) });
    return c.json({ cleared });
  });

  app.post('/api/comments/restore', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const restored = await restoreCleared(repoRoot);
    emit({ type: 'comments.reset', origin: originOf(c) });
    return c.json({ restored });
  });

  app.post('/api/export', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const b = await body(c);
    const branch =
      typeof b['branch'] === 'string' && b['branch'] ? b['branch'] : null;
    const format = b['format'] === 'json' ? 'json' : 'md';
    const all = await listComments(repoRoot, branch);
    const decorate = decorator(repoRoot);
    const comments = await Promise.all(
      all.filter((x) => !x.parentId && x.author === 'user').map(decorate)
    );
    if (!comments.length) return c.json({ count: 0, content: '', path: null });
    const content =
      format === 'json'
        ? buildJson(comments)
        : buildMarkdown(repoRoot, branch, comments);
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const dir = path.join(repoRoot, '.looksee');
    const filename = `review-${ts}.${format}`;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), content);
      await ensureExcluded(repoRoot);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
    return c.json({
      count: comments.length,
      content,
      path: path.posix.join('.looksee', filename),
    });
  });

  app.get('/api/saved-replies', async (c) =>
    c.json({ replies: await listSavedReplies() })
  );

  app.post('/api/saved-replies', async (c) => {
    const b = await body(c);
    const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
    const text = typeof b['body'] === 'string' ? b['body'].trim() : '';
    if (!name || !text) return c.json({ error: 'name and body required' }, 400);
    return c.json({ reply: await addSavedReply({ name, body: text }) });
  });

  app.delete('/api/saved-replies/:id', async (c) => {
    if (!(await deleteSavedReply(c.req.param('id'))))
      return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  app.post(
    '/api/attachments',
    bodyLimit({
      maxSize: MAX_ATTACHMENT_BYTES,
      onError: (c) => c.json({ error: 'too large' }, 400),
    }),
    async (c) => {
      if (!repoRoot) return c.json({ error: 'no repo' }, 400);
      const b = await body(c);
      if (typeof b['type'] !== 'string' || typeof b['data'] !== 'string')
        return c.json({ error: 'unsupported type' }, 400);
      try {
        const r = await saveAttachment(repoRoot, b['type'], b['data']);
        if ('error' in r) return c.json({ error: r.error }, 400);
        return c.json({
          url: r.url,
          path: r.path,
          name: typeof b['name'] === 'string' ? b['name'] : r.file,
        });
      } catch (err) {
        return c.json({ error: (err as Error).message }, 500);
      }
    }
  );

  app.get('/attachments/:file', async (c) => {
    const file = c.req.param('file');
    if (!repoRoot || !ATTACHMENT_NAME.test(file))
      return c.json({ error: 'not found' }, 404);
    try {
      const buf = await fs.readFile(path.join(attachmentsDir(repoRoot), file));
      const ext = file.split('.').pop() ?? '';
      return c.body(buf, 200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': 'private, max-age=3600',
      });
    } catch {
      return c.json({ error: 'not found' }, 404);
    }
  });

  return app;
}
