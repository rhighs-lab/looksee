import { git } from '@/server/git/exec.js';
import { pinRef, snapshotWorktree, unpinRef } from '@/server/git/snapshot.js';
import { getSession, repoKey, setSession } from '@/server/review/store.js';
import type {
  Comparison,
  Pin,
  ScopePreset,
  Session,
} from '@/shared/protocol.js';

export { getSession };

const PINS = ['opened', 'approved'] as const;
type PinName = (typeof PINS)[number];

const headSha = async (repoRoot: string): Promise<string> =>
  (
    await git(repoRoot, ['rev-parse', '-q', '--verify', 'HEAD'], {
      okCodes: [0, 1],
    })
  ).trim();

async function pin(repoRoot: string, name: PinName): Promise<Pin> {
  const tree = await snapshotWorktree(repoRoot);
  const head = await headSha(repoRoot);
  await pinRef(repoRoot, repoKey(repoRoot), name, tree);
  return { tree, head, at: new Date().toISOString() };
}

const unpin = (repoRoot: string, name: PinName): Promise<void> =>
  unpinRef(repoRoot, repoKey(repoRoot), name);

const live = async (repoRoot: string, cur: Session | null): Promise<Session> =>
  cur && !cur.endedAt
    ? cur
    : {
        openedAt: await pin(repoRoot, 'opened'),
        approvedAt: null,
        scope: 'session',
        custom: null,
        endedAt: null,
      };

export const ensureSession = (repoRoot: string): Promise<Session> =>
  setSession(repoRoot, (cur) => live(repoRoot, cur));

export const repin = (repoRoot: string): Promise<Session> =>
  setSession(repoRoot, async (cur) => {
    const openedAt = await pin(repoRoot, 'opened');
    await unpin(repoRoot, 'approved');
    return {
      scope: cur?.scope ?? 'session',
      custom: cur?.custom ?? null,
      openedAt,
      approvedAt: null,
      endedAt: null,
    };
  });

export const pinApproved = (repoRoot: string): Promise<Session> =>
  setSession(repoRoot, async (cur) => {
    const s = await live(repoRoot, cur);
    return { ...s, approvedAt: await pin(repoRoot, 'approved') };
  });

export const endSession = (repoRoot: string): Promise<Session | null> =>
  setSession(repoRoot, async (cur) => {
    if (!cur) return null;
    for (const name of PINS) await unpin(repoRoot, name);
    return { ...cur, endedAt: new Date().toISOString() };
  });

export const setScope = (
  repoRoot: string,
  preset: ScopePreset,
  custom?: Comparison
): Promise<Session> =>
  setSession(repoRoot, async (cur) => {
    const s = await live(repoRoot, cur);
    return { ...s, scope: preset, custom: custom ?? s.custom };
  });
