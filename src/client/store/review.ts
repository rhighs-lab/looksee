import { create } from 'zustand';
import { api } from '@/client/api/client.js';
import {
  type Connection,
  connectEvents,
  type EventSubscription,
} from '@/client/api/events.js';
import { prefs, type View } from '@/client/store/prefs.js';
import type {
  BranchesResponse,
  ChangedFile,
  Comparison,
  DiffLine,
  FileDiff,
  Layer,
  RepoRefs,
  RepoState,
  Scope,
  ScopePreset,
  ServerEvent,
  Session,
} from '@/shared/protocol.js';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface LoadedSegment {
  from: number;
  lines: DiffLine[];
}

export type Expansions = Record<string, LoadedSegment[]>;

export interface ReviewStore {
  status: LoadStatus;
  error: string | null;
  connection: Connection;
  state: RepoState | null;
  scope: Scope;
  layerFilter: Layer[];
  view: View;
  colorByLayer: boolean;
  diffs: Record<string, FileDiff>;
  pendingPaths: string[];
  expansions: Record<string, Expansions>;
  collapsed: Record<string, boolean>;
  viewed: Record<string, string>;
  updated: Record<string, true>;
  treeHidden: boolean;
  treeWidth: number | null;
  activePath: string | null;
  toast: { message: string; action?: { label: string; fn: () => void } } | null;
  eventListeners: Set<(ev: ServerEvent) => void>;
  branches: BranchesResponse | null;
  preset: ScopePreset;
  session: Session | null;

  init(): () => void;
  refresh(): Promise<void>;
  setScope(scope: Scope): Promise<void>;
  toggleLayerFilter(layer: Layer): void;
  clearLayerFilter(): void;
  setView(view: View): void;
  setColorByLayer(val: boolean): Promise<void>;
  loadFull(path: string): Promise<void>;
  setExpansions(path: string, ex: Expansions): void;
  toggleCollapsed(path: string, val?: boolean): void;
  setViewed(path: string, val: boolean): void;
  markSeen(path: string): void;
  setTreeHidden(val: boolean): void;
  setTreeWidth(px: number | null): void;
  setActivePath(path: string | null): void;
  loadBranches(): Promise<void>;
  setPreset(preset: ScopePreset, custom?: Comparison): Promise<void>;
  repin(): Promise<void>;
  endSession(): Promise<void>;
  showToast(message: string, action?: { label: string; fn: () => void }): void;
  hideToast(): void;
  onEvent(fn: (ev: ServerEvent) => void): () => void;
}

let sub: EventSubscription | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let refreshChain: Promise<void> = Promise.resolve();

const WORKTREE: Comparison['endpoint'] = { kind: 'worktree' };

export const customFrom = (
  preset: ScopePreset,
  session: Session | null,
  refs: RepoRefs | null
): Comparison => {
  const live = session && !session.endedAt ? session : null;
  if (preset === 'session' && live?.openedAt)
    return {
      baseline: { kind: 'pin', name: live.approvedAt ? 'approved' : 'opened' },
      endpoint: WORKTREE,
    };
  if (preset === 'branch' && refs?.mergeBase)
    return {
      baseline: { kind: 'merge-base', left: refs.base.ref, right: 'HEAD' },
      endpoint: WORKTREE,
    };
  return { baseline: { kind: 'head' }, endpoint: WORKTREE };
};

export const useReview = create<ReviewStore>((set, get) => {
  const applyDiffs = (
    files: FileDiff[],
    replaceAll: boolean,
    stateFiles: ChangedFile[]
  ) => {
    const prev = get().diffs;
    const next: Record<string, FileDiff> = replaceAll ? {} : { ...prev };
    const expansions = { ...get().expansions };
    const updated = { ...get().updated };
    for (const f of files) {
      const old = prev[f.path];
      if (old && old.digest !== f.digest) {
        delete expansions[f.path];
        if (old.digest !== 'unchanged') updated[f.path] = true;
      }
      next[f.path] =
        old &&
        old.digest === f.digest &&
        old.rev === f.rev &&
        old.truncated === f.truncated
          ? old
          : f;
    }
    if (replaceAll) {
      for (const p of Object.keys(expansions))
        if (!next[p]) delete expansions[p];
    } else {
      const known = new Set(stateFiles.map((f) => f.path));
      for (const p of Object.keys(next)) if (!known.has(p)) delete next[p];
    }
    set({ diffs: next, expansions, updated });
  };

  const reconcileViewed = (repoRoot: string | null, files: ChangedFile[]) => {
    const viewed = { ...get().viewed };
    const collapsed = { ...get().collapsed };
    let changed = false;
    for (const f of files) {
      const seen = viewed[f.path];
      if (seen !== undefined && seen !== f.digest) {
        delete viewed[f.path];
        delete collapsed[f.path];
        changed = true;
      }
    }
    if (changed) {
      prefs.setViewed(repoRoot, viewed);
      prefs.setCollapsed(repoRoot, collapsed);
      set({ viewed, collapsed });
    }
  };

  const loadAll = async (scope: Scope, state: RepoState) => {
    const res = await api.diff(scope, undefined, false, get().colorByLayer);
    applyDiffs(res.files, true, state.files);
  };

  const loadChanged = async (scope: Scope, state: RepoState) => {
    const cur = get().diffs;
    const stale = state.files
      .filter((f) => f.kind !== 'unchanged' && cur[f.path]?.digest !== f.digest)
      .map((f) => f.path);
    if (!stale.length) {
      applyDiffs([], false, state.files);
      return;
    }
    set({ pendingPaths: stale });
    try {
      const res = await api.diff(scope, stale, false, get().colorByLayer);
      applyDiffs(res.files, false, state.files);
    } finally {
      set({ pendingPaths: [] });
    }
  };

  const doRefresh = async (force: boolean) => {
    const wasReady = get().status === 'ready' && get().state !== null;
    try {
      const [state, session] = await Promise.all([api.state(), api.session()]);
      const prevRepo = get().state?.repoRoot;
      if (!wasReady || prevRepo !== state.repoRoot) {
        set({
          viewed: prefs.viewed(state.repoRoot),
          collapsed: prefs.collapsed(state.repoRoot),
        });
      }
      set({
        state,
        session,
        preset:
          state.comparison?.preset ??
          prefs.scope(state.repoRoot) ??
          get().preset,
      });
      reconcileViewed(state.repoRoot, state.files);
      if (state.error) {
        set({ status: 'error', error: state.error });
        return;
      }
      const scope = get().scope;
      if (!wasReady || force || scope !== 'cumulative')
        await loadAll(scope, state);
      else await loadChanged(scope, state);
      set({ status: 'ready', error: null });
    } catch (err) {
      set({
        status: get().state ? 'ready' : 'error',
        error: (err as Error).message,
      });
    }
  };

  return {
    status: 'loading',
    error: null,
    connection: 'off',
    state: null,
    scope: 'cumulative',
    layerFilter: [],
    view: prefs.view(),
    colorByLayer: prefs.colorByLayer(),
    diffs: {},
    pendingPaths: [],
    expansions: {},
    collapsed: {},
    viewed: {},
    updated: {},
    treeHidden: prefs.treeHidden(),
    treeWidth: prefs.treeWidth(),
    activePath: null,
    toast: null,
    eventListeners: new Set(),
    branches: null,
    preset: 'session',
    session: null,

    init() {
      void get().refresh();
      void get().loadBranches();
      sub?.close();
      sub = connectEvents(
        (ev) => {
          if (ev.type === 'state.changed' || ev.type === 'hello') {
            const cur = get().state;
            if (ev.type === 'state.changed' && cur && ev.version <= cur.version)
              return;
            void get().refresh();
          }
          for (const fn of get().eventListeners) fn(ev);
        },
        (connection) => set({ connection })
      );
      return () => {
        sub?.close();
        sub = null;
      };
    },

    refresh() {
      refreshChain = refreshChain.then(() => doRefresh(false));
      return refreshChain;
    },

    async setScope(scope) {
      if (scope === get().scope) return;
      set({ scope, expansions: {}, diffs: {}, status: 'loading' });
      refreshChain = refreshChain.then(() => doRefresh(true));
      await refreshChain;
    },

    toggleLayerFilter(layer) {
      const cur = get().layerFilter;
      set({
        layerFilter: cur.includes(layer)
          ? cur.filter((l) => l !== layer)
          : [...cur, layer],
      });
    },

    clearLayerFilter() {
      set({ layerFilter: [] });
    },

    setView(view) {
      prefs.setView(view);
      set({ view });
    },

    async setColorByLayer(val) {
      if (val === get().colorByLayer) return;
      prefs.setColorByLayer(val);
      set({ colorByLayer: val, diffs: {} });
      refreshChain = refreshChain.then(() => doRefresh(true));
      await refreshChain;
    },

    async loadFull(path) {
      const res = await api.diff(get().scope, [path], true, get().colorByLayer);
      const f = res.files[0];
      if (!f) return;
      set({ diffs: { ...get().diffs, [path]: f } });
    },

    setExpansions(path, ex) {
      set({ expansions: { ...get().expansions, [path]: ex } });
    },

    toggleCollapsed(path, val) {
      const collapsed = { ...get().collapsed };
      const next = val ?? !collapsed[path];
      if (next) collapsed[path] = true;
      else delete collapsed[path];
      prefs.setCollapsed(get().state?.repoRoot ?? null, collapsed);
      set({ collapsed });
    },

    setViewed(path, val) {
      const repoRoot = get().state?.repoRoot ?? null;
      const viewed = { ...get().viewed };
      const digest =
        get().state?.files.find((f) => f.path === path)?.digest ?? '';
      if (val) viewed[path] = digest;
      else delete viewed[path];
      prefs.setViewed(repoRoot, viewed);
      set({ viewed });
      get().toggleCollapsed(path, val);
      if (val) get().markSeen(path);
    },

    markSeen(path) {
      if (!get().updated[path]) return;
      const updated = { ...get().updated };
      delete updated[path];
      set({ updated });
    },

    setTreeHidden(val) {
      prefs.setTreeHidden(val);
      set({ treeHidden: val });
    },

    setTreeWidth(px) {
      prefs.setTreeWidth(px);
      set({ treeWidth: px });
    },

    setActivePath(path) {
      set({ activePath: path });
    },

    async loadBranches() {
      try {
        set({ branches: await api.branches() });
      } catch {
        /* outside a repo */
      }
    },

    async setPreset(preset, custom) {
      const prev = get().preset;
      if (preset === prev && !custom) return;
      const body =
        preset === 'custom' && !custom && !get().session?.custom
          ? customFrom(prev, get().session, get().state?.refs ?? null)
          : custom;
      set({ preset, expansions: {}, diffs: {}, status: 'loading' });
      try {
        const state = await api.setScope(preset, body);
        prefs.setScope(state.repoRoot, preset);
        set({ state });
      } catch (err) {
        set({ preset: prev });
        get().showToast(`Could not switch scope: ${(err as Error).message}`);
      }
      refreshChain = refreshChain.then(() => doRefresh(true));
      await refreshChain;
    },

    async repin() {
      try {
        await api.pin();
      } catch (err) {
        get().showToast(`Could not re-pin: ${(err as Error).message}`);
        return;
      }
      set({ expansions: {}, diffs: {} });
      refreshChain = refreshChain.then(() => doRefresh(true));
      await refreshChain;
    },

    async endSession() {
      try {
        await api.endSession();
      } catch (err) {
        get().showToast(`Could not end session: ${(err as Error).message}`);
        return;
      }
      set({ expansions: {}, diffs: {} });
      refreshChain = refreshChain.then(() => doRefresh(true));
      await refreshChain;
    },

    showToast(message, action) {
      if (toastTimer) clearTimeout(toastTimer);
      set({ toast: action ? { message, action } : { message } });
      toastTimer = setTimeout(() => set({ toast: null }), 6000);
    },

    hideToast() {
      if (toastTimer) clearTimeout(toastTimer);
      set({ toast: null });
    },

    onEvent(fn) {
      get().eventListeners.add(fn);
      return () => {
        get().eventListeners.delete(fn);
      };
    },
  };
});

export const selectVisibleFiles = (s: ReviewStore): ChangedFile[] => {
  const files = s.state?.files ?? [];
  if (s.scope !== 'cumulative') {
    const inScope = new Set(Object.keys(s.diffs));
    return files.filter((f) => inScope.has(f.path));
  }
  const net = files.filter((f) => f.kind !== 'unchanged');
  if (!s.layerFilter.length) return net;
  const want = new Set(s.layerFilter);
  return net.filter((f) => f.layers.some((l) => want.has(l.layer)));
};
