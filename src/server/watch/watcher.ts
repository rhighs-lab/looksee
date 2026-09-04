import fs from 'node:fs';
import path from 'node:path';
import {
  computeRepoState,
  readStatus,
  stateFingerprint,
  statusDigest,
} from '@/server/git/state.js';
import { getSession } from '@/server/review/store.js';
import type { EventHub } from '@/server/watch/events.js';
import type {
  Comparison,
  RepoState,
  ScopePreset,
  Session,
} from '@/shared/protocol.js';
import { LAYERS } from '@/shared/protocol.js';

export interface WatcherOpts {
  baseFlag: string | null;
  headRef?: string | null;
  preset?: ScopePreset;
  custom?: Comparison | null;
  debounceMs?: number;
  maxWaitMs?: number;
  gitDir?: string | null;
}

export interface Selection {
  base?: string | null;
  head?: string | null;
  preset?: ScopePreset;
  custom?: Comparison | null;
}

const pinsPart = (s: Session | null): string =>
  [s?.openedAt, s?.approvedAt]
    .map((p) => (p ? `${p.tree}@${p.at}` : ''))
    .join('|');

const IGNORED = [
  /(^|\/)\.git\/objects(\/|$)/,
  /(^|\/)\.git\/logs(\/|$)/,
  /\.lock$/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.looksee(\/|$)/,
];

export const emptyState = (
  repoRoot: string | null,
  error: string | null = null
): RepoState => ({
  version: 0,
  repoRoot,
  refs: null,
  comparison: null,
  drift: false,
  files: [],
  summary: {
    files: 0,
    additions: 0,
    deletions: 0,
    byLayer: Object.fromEntries(
      LAYERS.map((l) => [l, 0])
    ) as RepoState['summary']['byLayer'],
  },
  computedAt: new Date().toISOString(),
  error,
});

export class RepoWatcher {
  state: RepoState;
  statusDigest: string | null = null;
  private version = 0;
  private fingerprint = '';
  private timer: NodeJS.Timeout | null = null;
  private firstEventAt = 0;
  private chain: Promise<void> = Promise.resolve();
  private queued = false;
  private watchers: fs.FSWatcher[] = [];
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(
    readonly repoRoot: string,
    private opts: WatcherOpts,
    private readonly hub: EventHub
  ) {
    this.state = emptyState(repoRoot);
    this.debounceMs = opts.debounceMs ?? 150;
    this.maxWaitMs = opts.maxWaitMs ?? 1000;
  }

  async start(extra: Partial<WatcherOpts> = {}): Promise<void> {
    Object.assign(this.opts, extra);
    await this.refresh();
    this.watchDir(this.repoRoot);
    const gd = this.opts.gitDir;
    if (gd && !gd.startsWith(this.repoRoot + path.sep)) this.watchDir(gd);
  }

  private watchDir(dir: string): void {
    try {
      const w = fs.watch(
        dir,
        { recursive: true, persistent: false },
        (_ev, filename) => this.onEvent(filename)
      );
      w.on('error', () => {});
      this.watchers.push(w);
    } catch {
      /* platform without recursive watch: live updates degrade to manual refresh */
    }
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.timer) clearTimeout(this.timer);
  }

  private onEvent(filename: string | Buffer | null): void {
    const rel = filename ? String(filename).replace(/\\/g, '/') : '';
    if (rel && IGNORED.some((re) => re.test(rel))) return;
    this.schedule();
  }

  selection(): { base: string | null; head: string | null } {
    return { base: this.opts.baseFlag, head: this.opts.headRef ?? null };
  }

  scope(): { preset: ScopePreset; custom: Comparison | null } {
    return {
      preset: this.opts.preset ?? 'session',
      custom: this.opts.custom ?? null,
    };
  }

  async select(sel: Selection): Promise<void> {
    if (sel.base !== undefined) this.opts.baseFlag = sel.base;
    if (sel.head !== undefined) this.opts.headRef = sel.head;
    if (sel.preset !== undefined) this.opts.preset = sel.preset;
    if (sel.custom !== undefined) this.opts.custom = sel.custom;
    await this.refresh();
  }

  schedule(): void {
    const now = Date.now();
    if (!this.firstEventAt) this.firstEventAt = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(
      0,
      Math.min(this.debounceMs, this.firstEventAt + this.maxWaitMs - now)
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.firstEventAt = 0;
      void this.refresh();
    }, wait);
  }

  refresh(): Promise<void> {
    if (this.queued) return this.chain;
    this.queued = true;
    const p = this.chain.then(() => {
      this.queued = false;
      return this.run();
    });
    this.chain = p.catch(() => {});
    return p;
  }

  private async run(): Promise<void> {
    let next: RepoState;
    let session: Session | null = null;
    let digest: string | null = null;
    try {
      session = await getSession(this.repoRoot);
      const status = await readStatus(this.repoRoot);
      digest = await statusDigest(this.repoRoot, status);
      next = await computeRepoState(
        this.repoRoot,
        {
          ...this.scope(),
          session,
          status,
          baseFlag: this.opts.baseFlag,
          headRef: this.opts.headRef ?? null,
        },
        this.version + 1
      );
    } catch (err) {
      digest = null;
      next = {
        ...emptyState(this.repoRoot, (err as Error).message),
        version: this.version + 1,
      };
    }
    this.statusDigest = digest;
    const fp = `${stateFingerprint(next)}#${pinsPart(session)}${next.error ?? ''}`;
    if (fp === this.fingerprint && this.version > 0) return;
    this.fingerprint = fp;
    this.version = next.version;
    this.state = next;
    this.hub.emit({ type: 'state.changed', version: this.version });
  }

  get currentVersion(): number {
    return this.version;
  }
}
