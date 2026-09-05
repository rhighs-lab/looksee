import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from '@/server/context.js';
import { getBlobLines } from '@/server/git/blobs.js';
import { resolveComparison } from '@/server/git/comparison.js';
import { safeRelPath } from '@/server/git/paths.js';
import {
  ATTACHMENT_NAME,
  attachmentsDir,
  ensureExcluded,
  MAX_ATTACHMENT_BYTES,
  saveAttachment,
} from '@/server/review/attachments.js';
import {
  applySuggestion,
  canSee,
  decorator,
} from '@/server/review/decorate.js';
import { buildJson, buildMarkdown } from '@/server/review/export.js';
import {
  isSuggestionRoot,
  renderCommentHtml,
  renderMarkdown,
} from '@/server/review/markdown.js';
import { armPushGuard, disarmPushGuard } from '@/server/review/push-guard.js';
import {
  addSavedReply,
  deleteSavedReply,
  listSavedReplies,
} from '@/server/review/saved-replies.js';
import { getSession, pinApproved } from '@/server/review/session.js';
import {
  addComment,
  type CommentPatch,
  clearComments,
  deleteComment,
  discardReview,
  getComment,
  getReview,
  listComments,
  listReviews,
  PendingReviewError,
  restoreCleared,
  startReview,
  submitReview,
  updateComment,
} from '@/server/review/store.js';
import { parseSuggestions } from '@/server/review/suggestion.js';
import {
  type Comment,
  type CommentSide,
  type Comparison,
  type DecoratedComment,
  type Review,
  type ServerEvent,
  USER_ACTOR,
  VERDICTS,
  type Verdict,
} from '@/shared/protocol.js';

type Json = Record<string, unknown>;
type Req = { req: { header(n: string): string | undefined } };

const ACTOR = /^[A-Za-z0-9_.-]{1,64}$/;
const isVerdict = (v: unknown): v is Verdict => VERDICTS.includes(v as Verdict);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : null;

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
  const comparisonOf = async (): Promise<Comparison | null> => {
    const refs = ctx.state().refs;
    if (!refs || !ctx.watcher || !repoRoot) return null;
    const { preset, custom } = ctx.watcher.scope();
    return resolveComparison(preset, custom, await getSession(repoRoot), refs);
  };
  const originOf = (c: Req) => c.req.header('x-looksee-client') ?? null;
  const actorOf = (c: Req) => c.req.header('x-looksee-actor') || USER_ACTOR;
  const visibleComment = async (id: string, actor: string) => {
    const x = await getComment(repoRoot!, id);
    return x && (await canSee(repoRoot!, x, actor)) ? x : null;
  };
  const isDraft = async (x: Comment) => {
    if (!x.reviewId) return false;
    const rv = await getReview(repoRoot!, x.reviewId);
    return rv?.state === 'pending';
  };
  const reviewComments = async (rv: Review) => {
    const decorate = decorator(repoRoot);
    const all = await listComments(repoRoot!, null, rv.author);
    return Promise.all(all.filter((x) => x.reviewId === rv.id).map(decorate));
  };
  const ownedPending = async (
    id: string,
    actor: string
  ): Promise<
    { review: Review } | { status: 403 | 404 | 409; error: string }
  > => {
    const review = await getReview(repoRoot!, id);
    if (!review) return { status: 404, error: 'not found' };
    if (review.author !== actor) return { status: 403, error: 'not yours' };
    if (review.state !== 'pending')
      return { status: 409, error: 'already submitted' };
    return { review };
  };
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

  app.use('/api/*', async (c, next) => {
    const actor = c.req.header('x-looksee-actor');
    if (actor === USER_ACTOR)
      return c.json({ error: 'actor "user" is reserved for the browser' }, 400);
    if (actor !== undefined && !ACTOR.test(actor))
      return c.json({ error: 'invalid actor' }, 400);
    await next();
  });

  app.get('/api/reviews', async (c) => {
    if (!repoRoot) return c.json({ reviews: [] });
    const state = c.req.query('state');
    const author = str(c.req.query('author'));
    const reviews = await listReviews(repoRoot, {
      ...(state === 'pending' || state === 'submitted' ? { state } : {}),
      ...(author ? { author } : {}),
    });
    return c.json({ reviews });
  });

  app.post('/api/reviews', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const b = await body(c);
    try {
      const review = await startReview(repoRoot, {
        author: actorOf(c),
        branch: str(b['branch']),
      });
      const head = ctx.state().refs?.head;
      const guard = await armPushGuard(
        repoRoot,
        review.branch ?? (head?.checkedOut ? head.branch : null)
      ).catch(() => 'failed' as const);
      return c.json({ review, guard });
    } catch (err) {
      if (err instanceof PendingReviewError)
        return c.json(
          { error: err.message, code: err.code, review: err.review },
          409
        );
      throw err;
    }
  });

  app.get('/api/reviews/:id', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const review = await getReview(repoRoot, c.req.param('id'));
    if (!review) return c.json({ error: 'not found' }, 404);
    if (review.state === 'pending' && review.author !== actorOf(c))
      return c.json({ error: 'not yours' }, 403);
    return c.json({ review, comments: await reviewComments(review) });
  });

  app.post('/api/reviews/:id/submit', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const b = await body(c);
    if (!isVerdict(b['verdict'])) return c.json({ error: 'bad verdict' }, 400);
    const r = await ownedPending(c.req.param('id'), actorOf(c));
    if ('status' in r) return c.json({ error: r.error }, r.status);
    const review = await submitReview(repoRoot, r.review.id, {
      verdict: b['verdict'],
      body: typeof b['body'] === 'string' ? b['body'] : '',
      comparison: await comparisonOf(),
    });
    if (!review) return c.json({ error: 'not found' }, 404);
    await disarmPushGuard(repoRoot).catch(() => {});
    if (review.verdict === 'approve' && actorOf(c) === USER_ACTOR) {
      await pinApproved(repoRoot).catch((err: unknown) => {
        console.error(`looksee: approve pin failed: ${String(err)}`);
      });
      await ctx.watcher?.refresh();
    }
    const comments = await reviewComments(review);
    emit({ type: 'review.submitted', review, comments, origin: originOf(c) });
    return c.json({ review, comments });
  });

  app.delete('/api/reviews/:id', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const r = await ownedPending(c.req.param('id'), actorOf(c));
    if ('status' in r) return c.json({ error: r.error }, r.status);
    const ok = await discardReview(repoRoot, r.review.id);
    await disarmPushGuard(repoRoot).catch(() => {});
    return c.json({ ok });
  });

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
    let comments = await listComments(repoRoot, branch, actorOf(c));
    if (status === 'open' || status === 'resolved')
      comments = comments.filter((x) => x.status === status);
    if (author) comments = comments.filter((x) => x.author === author);
    if (rootsOnly) comments = comments.filter((x) => !x.parentId);
    const decorate = decorator(repoRoot);
    return c.json({ comments: await Promise.all(comments.map(decorate)) });
  });

  app.post('/api/comments', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const b = await body(c);
    const author = actorOf(c);
    if (b['parentId']) {
      const parent = await visibleComment(String(b['parentId']), author);
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
        reviewId: parent.reviewId,
      });
      const out = await decorator(repoRoot)(reply);
      if (!(await isDraft(parent)))
        emit({ type: 'comment.replied', comment: out, origin: originOf(c) });
      return c.json({ comment: out });
    }
    const reviewId = str(b['reviewId']);
    if (reviewId) {
      const r = await ownedPending(reviewId, author);
      if ('status' in r) return c.json({ error: r.error }, r.status);
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
      branch: str(b['branch']),
      lineSnapshot: snapshot,
      reviewId,
    });
    const out = await decorator(repoRoot)(comment);
    if (!reviewId)
      emit({ type: 'comment.created', comment: out, origin: originOf(c) });
    return c.json({ comment: out });
  });

  app.patch('/api/comments/:id', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const b = await body(c);
    const actor = actorOf(c);
    const cur = await visibleComment(c.req.param('id'), actor);
    if (!cur) return c.json({ error: 'not found' }, 404);
    const draft = await isDraft(cur);
    const patch: CommentPatch = {};
    if (typeof b['body'] === 'string') {
      if (!draft)
        return c.json({ error: 'body is immutable once published' }, 409);
      patch.body = b['body'];
    }
    if (b['status'] === 'open' || b['status'] === 'resolved')
      patch.status = b['status'];
    const comment = await updateComment(repoRoot, cur.id, patch);
    if (!comment) return c.json({ error: 'not found' }, 404);
    if (patch.status && patch.status !== cur.status && !draft)
      emit({
        type:
          patch.status === 'resolved' ? 'thread.resolved' : 'thread.reopened',
        id: comment.id,
        actor,
        origin: originOf(c),
      });
    return c.json({ comment: await decorator(repoRoot)(comment) });
  });

  app.delete('/api/comments/:id', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const cur = await visibleComment(c.req.param('id'), actorOf(c));
    if (!cur) return c.json({ ok: false, removed: 0 });
    const removed = await deleteComment(repoRoot, cur.id);
    if (removed && !(await isDraft(cur)))
      emit({ type: 'comment.deleted', id: cur.id, origin: originOf(c) });
    return c.json({ ok: Boolean(removed), removed });
  });

  app.post('/api/comments/:id/apply', async (c) => {
    if (!repoRoot) return c.json({ error: 'no repo' }, 400);
    const r = await applySuggestion(repoRoot, c.req.param('id'), actorOf(c));
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
    const actor = actorOf(c);
    const all = await listComments(repoRoot, branch, actor);
    const pending = new Set(
      (await listReviews(repoRoot, { state: 'pending' })).map((r) => r.id)
    );
    const candidates = all
      .filter(
        (x) =>
          isSuggestionRoot(x) &&
          x.status === 'open' &&
          !(x.reviewId && pending.has(x.reviewId)) &&
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
      const r = await applySuggestion(repoRoot, x.id, actor);
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
    const cleared = await clearComments(repoRoot, str(b['branch']));
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
    const branch = str(b['branch']);
    const format = b['format'] === 'json' ? 'json' : 'md';
    const all = await listComments(repoRoot, branch, actorOf(c));
    const decorate = decorator(repoRoot);
    const comments = await Promise.all(
      all.filter((x) => !x.parentId).map(decorate)
    );
    if (!comments.length) return c.json({ count: 0, content: '', path: null });
    const content =
      format === 'json'
        ? buildJson(comments)
        : buildMarkdown(repoRoot, branch, comments, {
            comparison: ctx.state().comparison?.label ?? null,
          });
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
