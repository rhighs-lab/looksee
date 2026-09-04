import { create } from 'zustand';
import { ApiError, api, CLIENT_ID } from '@/client/api/client.js';
import { useReview } from '@/client/store/review.js';
import type {
  CommentSide,
  CommentStatus,
  DecoratedComment,
  DoneMark,
  Review,
  ServerEvent,
  Verdict,
} from '@/shared/protocol.js';
import { USER_ACTOR } from '@/shared/protocol.js';

export interface Thread {
  root: DecoratedComment;
  replies: DecoratedComment[];
}

export interface ComposeAnchor {
  filePath: string;
  side: CommentSide;
  startLine: number;
  endLine: number;
  snapshot: string[];
}

export interface CommentsStore {
  enabled: boolean;
  branch: string | null;
  threads: Record<string, Thread>;
  compose: ComposeAnchor | null;
  loaded: boolean;
  pendingReview: Review | null;
  reviews: Review[];
  done: DoneMark[];
  bannerDismissedAt: string | null;

  load(): Promise<void>;
  bind(): () => void;
  openCompose(anchor: ComposeAnchor): void;
  closeCompose(): void;
  submitCompose(body: string): Promise<void>;
  reply(rootId: string, body: string): Promise<void>;
  setStatus(id: string, status: CommentStatus): Promise<void>;
  remove(id: string): Promise<void>;
  apply(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  applyAll(): Promise<void>;
  exportAll(): Promise<void>;
  clearAll(): Promise<void>;
  restore(): Promise<void>;
  startReview(): Promise<void>;
  startReviewWith(body: string): Promise<void>;
  submitReview(verdict: Verdict, body: string): Promise<void>;
  discardReview(): Promise<void>;
  editDraft(id: string, body: string): Promise<void>;
  dismissBanner(): void;
}

const byRoot = (comments: DecoratedComment[]): Record<string, Thread> => {
  const threads: Record<string, Thread> = {};
  for (const c of comments)
    if (!c.parentId) threads[c.id] = { root: c, replies: [] };
  for (const c of comments)
    if (c.parentId && threads[c.parentId]) threads[c.parentId]!.replies.push(c);
  for (const t of Object.values(threads))
    t.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return threads;
};

const ownPending = (reviews: Review[]): Review | null =>
  reviews.find((r) => r.state === 'pending' && r.author === USER_ACTOR) ?? null;

export const useComments = create<CommentsStore>((set, get) => {
  const upsert = (c: DecoratedComment) => {
    const threads = { ...get().threads };
    if (!c.parentId) {
      threads[c.id] = { root: c, replies: threads[c.id]?.replies ?? [] };
    } else {
      const t = threads[c.parentId];
      if (!t) return;
      const i = t.replies.findIndex((r) => r.id === c.id);
      const replies =
        i >= 0
          ? t.replies.map((r) => (r.id === c.id ? c : r))
          : [...t.replies, c];
      threads[c.parentId] = { ...t, replies };
    }
    set({ threads });
  };

  const drop = (id: string) => {
    const threads = { ...get().threads };
    if (threads[id]) delete threads[id];
    else
      for (const [k, t] of Object.entries(threads))
        if (t.replies.some((r) => r.id === id))
          threads[k] = { ...t, replies: t.replies.filter((r) => r.id !== id) };
    set({ threads });
  };

  const setRootStatus = (id: string, status: CommentStatus) => {
    const t = get().threads[id];
    if (!t) return;
    set({
      threads: {
        ...get().threads,
        [id]: { ...t, root: { ...t.root, status } },
      },
    });
  };

  const putReview = (review: Review) => {
    const reviews = get().reviews.filter((r) => r.id !== review.id);
    reviews.push(review);
    set({ reviews, pendingReview: ownPending(reviews) });
  };

  return {
    enabled: false,
    branch: null,
    threads: {},
    compose: null,
    loaded: false,
    pendingReview: null,
    reviews: [],
    done: [],
    bannerDismissedAt: null,

    async load() {
      const state = useReview.getState().state;
      const enabled = Boolean(state?.repoRoot);
      const branch = state?.refs?.head.branch ?? null;
      set({ enabled, branch });
      if (!enabled) {
        set({ threads: {}, loaded: true });
        return;
      }
      try {
        const [{ comments }, { reviews }, { done }] = await Promise.all([
          api.comments(branch),
          api.listReviews(),
          api.listDone(),
        ]);
        set({
          threads: byRoot(comments),
          reviews,
          pendingReview: ownPending(reviews),
          done,
          loaded: true,
        });
      } catch {
        set({ loaded: true });
      }
    },

    bind() {
      const unsubReview = useReview.subscribe((s, prev) => {
        const a = s.state?.repoRoot ?? null;
        const b = prev.state?.repoRoot ?? null;
        const ba = s.state?.refs?.head.branch ?? null;
        const bb = prev.state?.refs?.head.branch ?? null;
        if (s.state && (a !== b || ba !== bb || !get().loaded))
          void get().load();
      });
      const unsubEvents = useReview.getState().onEvent((ev: ServerEvent) => {
        if (ev.type === 'hello') {
          if (ev.version === -1) void get().load();
          return;
        }
        if (ev.type === 'state.changed') return;
        if (ev.origin === CLIENT_ID) return;
        switch (ev.type) {
          case 'comment.created':
          case 'comment.updated':
          case 'comment.replied': {
            const c = ev.comment;
            if (c.branch && get().branch && c.branch !== get().branch) return;
            upsert(c);
            return;
          }
          case 'comment.deleted':
            drop(ev.id);
            return;
          case 'thread.resolved':
            setRootStatus(ev.id, 'resolved');
            return;
          case 'thread.reopened':
            setRootStatus(ev.id, 'open');
            return;
          case 'review.submitted':
          case 'comments.reset':
            void get().load();
            return;
          case 'done.requested':
            set({
              done: [
                ...get().done,
                { actor: ev.actor, body: ev.body, at: ev.at },
              ],
            });
            return;
          case 'diff.changed':
            void useReview.getState().refresh();
            return;
        }
      });
      if (useReview.getState().state) void get().load();
      return () => {
        unsubReview();
        unsubEvents();
      };
    },

    openCompose(anchor) {
      set({ compose: anchor });
    },

    closeCompose() {
      set({ compose: null });
    },

    async submitCompose(body) {
      const a = get().compose;
      if (!a || !body.trim()) return;
      const reviewId = get().pendingReview?.id ?? null;
      const { comment } = await api.createComment({
        filePath: a.filePath,
        side: a.side,
        startLine: a.startLine,
        endLine: a.endLine,
        body,
        branch: get().branch,
        lineSnapshot: a.snapshot,
        reviewId,
      });
      upsert(comment);
      set({ compose: null });
      if (!reviewId) set({ bannerDismissedAt: new Date().toISOString() });
    },

    async reply(rootId, body) {
      if (!body.trim()) return;
      const { comment } = await api.createComment({ parentId: rootId, body });
      upsert(comment);
    },

    async setStatus(id, status) {
      const { comment } = await api.patchComment(id, { status });
      upsert(comment);
    },

    async remove(id) {
      await api.deleteComment(id);
      drop(id);
    },

    async apply(id) {
      try {
        const { comment } = await api.applySuggestion(id);
        upsert(comment);
        void useReview.getState().refresh();
        return { ok: true };
      } catch (err) {
        const e = err as {
          body?: { outdated?: boolean; error?: string };
          message: string;
        };
        if (e.body?.outdated) {
          const { comments } = await api
            .comments(get().branch)
            .catch(() => ({ comments: [] as DecoratedComment[] }));
          const fresh = comments.find((c) => c.id === id);
          if (fresh) upsert(fresh);
          return { ok: false, message: 'The file changed since this comment' };
        }
        return {
          ok: false,
          message: e.body?.error ?? e.message ?? 'Apply failed',
        };
      }
    },

    async applyAll() {
      const toast = useReview.getState().showToast;
      try {
        const { applied, skipped } = await api.applyAll(get().branch);
        for (const c of applied) upsert(c);
        toast(
          `Applied ${applied.length} suggestion${applied.length === 1 ? '' : 's'}${skipped.length ? `, ${skipped.length} skipped` : ''}`
        );
        void useReview.getState().refresh();
      } catch {
        toast('Apply failed');
      }
    },

    async exportAll() {
      const toast = useReview.getState().showToast;
      try {
        const data = await api.exportComments(get().branch, 'md');
        if (!data.count) return toast('No comments to export.');
        let copied = false;
        try {
          await navigator.clipboard.writeText(data.content);
          copied = true;
        } catch {
          /* clipboard blocked */
        }
        toast(
          `Wrote ${data.path}${copied ? ' · copied to clipboard' : ' (clipboard blocked)'}`,
          { label: 'Clear now', fn: () => void get().clearAll() }
        );
      } catch {
        toast('Export failed.');
      }
    },

    async clearAll() {
      const toast = useReview.getState().showToast;
      const { cleared } = await api.clearComments(get().branch);
      set({ threads: {}, compose: null });
      toast(`Cleared ${cleared} comment${cleared === 1 ? '' : 's'}`, {
        label: 'Undo',
        fn: () => void get().restore(),
      });
    },

    async restore() {
      const { restored } = await api.restoreComments();
      if (!restored) return;
      await get().load();
      useReview
        .getState()
        .showToast(`Restored ${restored} comment${restored === 1 ? '' : 's'}`);
    },

    async startReviewWith(body) {
      if (!body.trim()) return;
      await get().startReview();
      if (!get().pendingReview) return;
      await get().submitCompose(body);
    },

    async startReview() {
      try {
        const { review } = await api.startReview(get().branch);
        putReview(review);
      } catch (err) {
        const b = (err as ApiError).body as { review?: Review } | null;
        if (err instanceof ApiError && err.status === 409 && b?.review) {
          putReview(b.review);
          return;
        }
        useReview.getState().showToast('Could not start the review');
      }
    },

    async submitReview(verdict, body) {
      const pending = get().pendingReview;
      if (!pending) return;
      const { review, comments } = await api.submitReview(
        pending.id,
        verdict,
        body
      );
      for (const c of comments) upsert(c);
      putReview(review);
    },

    async discardReview() {
      const pending = get().pendingReview;
      if (!pending) return;
      await api.discardReview(pending.id);
      const threads: Record<string, Thread> = {};
      for (const [k, t] of Object.entries(get().threads))
        if (t.root.reviewId !== pending.id) threads[k] = t;
      set({
        threads,
        reviews: get().reviews.filter((r) => r.id !== pending.id),
        pendingReview: null,
      });
    },

    async editDraft(id, body) {
      if (!body.trim()) return;
      const { comment } = await api.patchComment(id, { body });
      upsert(comment);
    },

    dismissBanner() {
      set({ bannerDismissedAt: new Date().toISOString() });
    },
  };
});

export const canApply = (c: DecoratedComment): boolean =>
  !c.parentId &&
  c.side === 'new' &&
  c.status === 'open' &&
  c.applicable === true;

export const reviewOf = (
  s: CommentsStore,
  c: DecoratedComment
): Review | null =>
  c.reviewId ? (s.reviews.find((r) => r.id === c.reviewId) ?? null) : null;

export const isDraft = (s: CommentsStore, c: DecoratedComment): boolean =>
  c.reviewId !== null && c.reviewId === s.pendingReview?.id;

export const selectDraftCount = (s: CommentsStore): number => {
  const id = s.pendingReview?.id;
  if (!id) return 0;
  return Object.values(s.threads).filter((t) => t.root.reviewId === id).length;
};

export const selectBanner = (s: CommentsStore): DoneMark | null => {
  const d = s.done[s.done.length - 1];
  if (!d) return null;
  const last = s.reviews
    .filter((r) => r.author === USER_ACTOR && r.submittedAt)
    .map((r) => r.submittedAt as string)
    .sort()
    .pop();
  if (last && last >= d.at) return null;
  if (s.bannerDismissedAt && s.bannerDismissedAt >= d.at) return null;
  return d;
};
