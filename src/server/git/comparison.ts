import { git } from '@/server/git/exec.js';
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
      return custom ?? { baseline: HEAD, endpoint: WORKTREE };
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
  return { kind, oid, short: short(sha), label: label(short(sha)) };
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
      return { kind: 'worktree', oid, short: short(oid), label: 'workspace' };
    }
    case 'index': {
      const oid =
        (await indexTree(repoRoot)) ?? (await snapshotWorktree(repoRoot));
      return { kind: 'index', oid, short: short(oid), label: 'index' };
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
      return {
        kind: 'pin',
        oid: pin.tree,
        short: short(pin.head),
        label: `${PIN_LABEL[ep.name]} ${short(pin.head)}`,
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
