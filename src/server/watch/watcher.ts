import fs from 'node:fs';
import path from 'node:path';
import { computeRepoState, stateFingerprint } from '@/server/git/state.js';
import type { EventHub } from '@/server/watch/events.js';
import type { RepoState } from '@/shared/protocol.js';
import { LAYERS } from '@/shared/protocol.js';

export interface WatcherOpts {
  baseFlag: string | null;
  headRef?: string | null;
  debounceMs?: number;
  maxWaitMs?: number;
  gitDir?: string | null;
}

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

  async start(): Promise<void> {
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

  async select(sel: {
    base?: string | null;
    head?: string | null;
  }): Promise<void> {
    if (sel.base !== undefined) this.opts.baseFlag = sel.base;
    if (sel.head !== undefined) this.opts.headRef = sel.head;
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
    try {
      next = await computeRepoState(
        this.repoRoot,
        { baseFlag: this.opts.baseFlag, headRef: this.opts.headRef ?? null },
        this.version + 1
      );
    } catch (err) {
      next = {
        ...emptyState(this.repoRoot, (err as Error).message),
        version: this.version + 1,
      };
    }
    const fp = stateFingerprint(next) + (next.error ?? '');
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
