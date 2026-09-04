import type { EventHub } from '@/server/watch/events.js';
import type { RepoWatcher } from '@/server/watch/watcher.js';
import type { RepoState } from '@/shared/protocol.js';

export interface AppOpts {
  repoRoot: string | null;
  defaultBase?: string | null;
  title?: string | null;
  clientDir?: string | null;
  debounceMs?: number;
}

export interface AppContext {
  repoRoot: string | null;
  hub: EventHub;
  watcher: RepoWatcher | null;
  state(): RepoState;
  statusDigest(): string | null;
  clientDir: string | null;
}
