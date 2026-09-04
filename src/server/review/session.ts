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
type Pinner = (name: PinName) => Promise<Pin>;

const headSha = async (repoRoot: string): Promise<string> =>
  (
    await git(repoRoot, ['rev-parse', '-q', '--verify', 'HEAD'], {
      okCodes: [0, 1],
    })
  ).trim();

async function writePin(
  repoRoot: string,
  name: PinName,
  p: Pin
): Promise<void> {
  const key = repoKey(repoRoot);
  await pinRef(repoRoot, key, name, p.tree);
  if (p.head) await pinRef(repoRoot, key, `${name}-head`, p.head);
  else await unpinRef(repoRoot, key, `${name}-head`);
}

async function unpin(repoRoot: string, name: PinName): Promise<void> {
  const key = repoKey(repoRoot);
  await unpinRef(repoRoot, key, name);
  await unpinRef(repoRoot, key, `${name}-head`);
}

async function update<S extends Session | null>(
  repoRoot: string,
  fn: (cur: Session | null, pin: Pinner) => Promise<S>
): Promise<S> {
  const made: PinName[] = [];
  const pin: Pinner = async (name) => {
    const tree = await snapshotWorktree(repoRoot);
    const head = await headSha(repoRoot);
    const p = { tree, head, at: new Date().toISOString() };
    made.push(name);
    await writePin(repoRoot, name, p);
    return p;
  };
  try {
    return await setSession(repoRoot, (cur) => fn(cur, pin));
  } catch (err) {
    for (const name of made) await unpin(repoRoot, name);
    throw err;
  }
}

const live = async (cur: Session | null, pin: Pinner): Promise<Session> =>
  cur && !cur.endedAt
    ? cur
    : {
        openedAt: await pin('opened'),
        approvedAt: null,
        scope: 'session',
        custom: null,
        endedAt: null,
      };

export const ensureSession = (repoRoot: string): Promise<Session> =>
  update(repoRoot, live);

export const repin = (repoRoot: string): Promise<Session> =>
  update(repoRoot, async (cur, pin) => {
    const openedAt = await pin('opened');
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
  update(repoRoot, async (cur, pin) => {
    const s = await live(cur, pin);
    return { ...s, approvedAt: await pin('approved') };
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
  update(repoRoot, async (cur, pin) => {
    const s = await live(cur, pin);
    return { ...s, scope: preset, custom: custom ?? s.custom };
  });
