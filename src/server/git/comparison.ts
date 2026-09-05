import { git, isSafeRef } from '@/server/git/exec.js';
import { mergeBase } from '@/server/git/refs.js';
import { indexTree, snapshotWorktree, treeOf } from '@/server/git/snapshot.js';
import type {
  Comparison,
  Endpoint,
  Pin,
  RepoRefs,
  Resolved,
  ScopePreset,
  Session,
} from '@/shared/protocol.js';

export interface EndpointCtx {
  session: Session | null;
  head: RepoRefs['head'];
}

const WORKTREE: Endpoint = { kind: 'worktree' };
const HEAD: Endpoint = { kind: 'head' };
const short = (sha: string): string => sha.slice(0, 7);

const PIN_LABEL = { opened: 'Session start', approved: 'Last approval' };
const SINCE = { opened: 'Since session start', approved: 'Since approval' };

export function parseEndpoint(v: unknown): Endpoint | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  switch (e['kind']) {
    case 'head':
    case 'index':
    case 'worktree':
      return { kind: e['kind'] };
    case 'commit':
      return isSafeRef(e['oid']) ? { kind: 'commit', oid: e['oid'] } : null;
    case 'ref':
      return isSafeRef(e['name']) ? { kind: 'ref', name: e['name'] } : null;
    case 'merge-base':
      return isSafeRef(e['left']) && isSafeRef(e['right'])
        ? { kind: 'merge-base', left: e['left'], right: e['right'] }
        : null;
    case 'pin':
      return e['name'] === 'opened' || e['name'] === 'approved'
        ? { kind: 'pin', name: e['name'] }
        : null;
    default:
      return null;
  }
}

export function parseComparison(v: unknown): Comparison | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const baseline = parseEndpoint(c['baseline']);
  const endpoint = parseEndpoint(c['endpoint']);
  return baseline && endpoint ? { baseline, endpoint } : null;
}

export function resolveComparison(
  preset: ScopePreset,
  custom: Comparison | null,
  session: Session | null,
  refs: RepoRefs
): Comparison {
  const live = session && !session.endedAt ? session : null;
  switch (preset) {
    case 'session': {
      const name = live?.approvedAt
        ? 'approved'
        : live?.openedAt
          ? 'opened'
          : null;
      return {
        baseline: name ? { kind: 'pin', name } : HEAD,
        endpoint: WORKTREE,
      };
    }
    case 'working':
      return { baseline: HEAD, endpoint: WORKTREE };
    case 'branch':
      return {
        baseline: refs.mergeBase
          ? {
              kind: 'merge-base',
              left: refs.base.ref,
              right: refs.head.checkedOut ? 'HEAD' : refs.head.sha,
            }
          : HEAD,
        endpoint: WORKTREE,
      };
    case 'custom':
      return custom ?? resolveComparison('session', null, session, refs);
  }
}

const commitSha = async (repoRoot: string, rev: string): Promise<string> =>
  (await git(repoRoot, ['rev-parse', '--verify', `${rev}^{commit}`])).trim();

async function commitTree(
  repoRoot: string,
  kind: Endpoint['kind'],
  rev: string,
  label: (sha: string) => string
): Promise<Resolved> {
  const sha = await commitSha(repoRoot, rev);
  const oid = await treeOf(repoRoot, sha);
  return {
    kind,
    oid,
    commit: sha,
    short: short(sha),
    label: label(short(sha)),
  };
}

export async function resolveEndpoint(
  repoRoot: string,
  ep: Endpoint,
  ctx: EndpointCtx
): Promise<Resolved> {
  const { head } = ctx;
  switch (ep.kind) {
    case 'worktree': {
      if (!head.checkedOut)
        return commitTree(
          repoRoot,
          'worktree',
          head.sha,
          (s) => `${head.branch ?? 'HEAD'} ${s}`
        );
      const oid = await snapshotWorktree(repoRoot);
      return {
        kind: 'worktree',
        oid,
        commit: null,
        short: short(oid),
        label: 'workspace',
      };
    }
    case 'index': {
      const oid =
        (await indexTree(repoRoot)) ?? (await snapshotWorktree(repoRoot));
      return {
        kind: 'index',
        oid,
        commit: null,
        short: short(oid),
        label: 'index',
      };
    }
    case 'head':
      return commitTree(
        repoRoot,
        'head',
        head.checkedOut ? 'HEAD' : head.sha,
        (s) => `HEAD ${s}`
      );
    case 'commit':
      return commitTree(repoRoot, 'commit', ep.oid, (s) => s);
    case 'ref':
      return commitTree(repoRoot, 'ref', ep.name, (s) => `${ep.name} ${s}`);
    case 'merge-base': {
      const mb = await mergeBase(repoRoot, ep.left, ep.right);
      if (!mb) throw new Error(`no merge base for ${ep.left} and ${ep.right}`);
      return commitTree(
        repoRoot,
        'merge-base',
        mb,
        (s) => `${ep.left} ${s} (merge base)`
      );
    }
    case 'pin': {
      const pin = ctx.session?.[`${ep.name}At`] ?? null;
      if (!pin) throw new Error(`no ${ep.name} pin`);
      const s = short(pin.head || pin.tree);
      return {
        kind: 'pin',
        oid: pin.tree,
        commit: pin.head || null,
        short: s,
        label: `${PIN_LABEL[ep.name]} ${s}`,
      };
    }
  }
}

export async function driftOf(
  repoRoot: string,
  pin: Pin,
  headSha: string
): Promise<boolean> {
  if (!pin.head || !headSha || pin.head === headSha) return false;
  return (await mergeBase(repoRoot, pin.head, headSha)) !== pin.head;
}

export function labelOf(
  cmp: Comparison,
  resolved: { baseline: Resolved; endpoint: Resolved }
): string {
  const from =
    cmp.baseline.kind === 'pin'
      ? `${SINCE[cmp.baseline.name]} ${resolved.baseline.short}`
      : resolved.baseline.label;
  return `${from} to ${resolved.endpoint.label}`;
}
