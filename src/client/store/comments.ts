import { create } from 'zustand';
import { api, CLIENT_ID } from '@/client/api/client.js';
import { useReview } from '@/client/store/review.js';
import type {
  CommentSide,
  DecoratedComment,
  ServerEvent,
} from '@/shared/protocol.js';

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

  load(): Promise<void>;
  bind(): () => void;
  openCompose(anchor: ComposeAnchor): void;
  closeCompose(): void;
  submitCompose(body: string): Promise<void>;
  reply(rootId: string, body: string): Promise<void>;
  setStatus(id: string, status: 'open' | 'resolved'): Promise<void>;
  remove(id: string): Promise<void>;
  apply(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  handoff(id: string): Promise<void>;
  applyAll(): Promise<void>;
  exportAll(): Promise<void>;
  clearAll(): Promise<void>;
  restore(): Promise<void>;
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

  return {
    enabled: false,
    branch: null,
    threads: {},
    compose: null,
    loaded: false,

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
        const { comments } = await api.comments(branch);
        set({ threads: byRoot(comments), loaded: true });
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
          case 'comment.updated': {
            const c = ev.comment;
            if (c.branch && get().branch && c.branch !== get().branch) return;
            upsert(c);
            return;
          }
          case 'comment.deleted':
            drop(ev.id);
            return;
          case 'comments.reset':
            void get().load();
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
      const { comment } = await api.createComment({
        filePath: a.filePath,
        side: a.side,
        startLine: a.startLine,
        endLine: a.endLine,
        body,
        branch: get().branch,
        lineSnapshot: a.snapshot,
      });
      upsert(comment);
      set({ compose: null });
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

    async handoff(id) {
      const { comment } = await api.patchComment(id, { handoff: 'agent' });
      upsert(comment);
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
  };
});

export const canApply = (c: DecoratedComment): boolean =>
  !c.parentId &&
  c.side === 'new' &&
  c.status === 'open' &&
  c.applicable === true &&
  c.handoff !== 'agent';
