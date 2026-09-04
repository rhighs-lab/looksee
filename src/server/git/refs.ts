import fs from 'node:fs/promises';
import path from 'node:path';
import { assertRef, git, gitDir } from '@/server/git/exec.js';
import type { BaseSource, RepoRefs } from '@/shared/protocol.js';

async function revParse(repoRoot: string, ref: string): Promise<string | null> {
  try {
    return (
      (
        await git(repoRoot, [
          'rev-parse',
          '--verify',
          '--quiet',
          `${ref}^{commit}`,
        ])
      ).trim() || null
    );
  } catch {
    return null;
  }
}

export async function getHead(
  repoRoot: string,
  headRef: string | null = null
): Promise<RepoRefs['head']> {
  const current = (
    await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')
  ).trim();
  const currentDetached = !current || current === 'HEAD';
  if (headRef && headRef !== 'HEAD' && headRef !== current) {
    const ref = assertRef(headRef);
    const sha = await revParse(repoRoot, ref);
    if (!sha) throw new Error(`unknown ref: ${ref}`);
    return { branch: ref, sha, detached: false, checkedOut: false };
  }
  const sha = (await revParse(repoRoot, 'HEAD')) ?? '';
  return {
    branch: currentDetached ? null : current,
    sha,
    detached: currentDetached,
    checkedOut: true,
  };
}

export async function getUpstream(
  repoRoot: string,
  branch: string | null
): Promise<{ ref: string; remote: string; sha: string } | null> {
  if (!branch) return null;
  try {
    const ref = (
      await git(repoRoot, [
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        `${branch}@{upstream}`,
      ])
    ).trim();
    if (!ref) return null;
    const sha = await revParse(repoRoot, ref);
    if (!sha) return null;
    const remote = (
      await git(repoRoot, ['config', '--get', `branch.${branch}.remote`]).catch(
        () => ''
      )
    ).trim();
    return { ref, remote: remote || ref.split('/')[0] || '', sha };
  } catch {
    return null;
  }
}

export async function listBranches(
  repoRoot: string
): Promise<{ local: string[]; remote: string[] }> {
  const out = await git(repoRoot, [
    'for-each-ref',
    '--format=%(refname:short)%09%(refname)',
    'refs/heads',
    'refs/remotes',
  ]).catch(() => '');
  const local: string[] = [];
  const remote: string[] = [];
  for (const line of out.split('\n')) {
    const [short, full] = line.split('\t');
    if (!short || !full) continue;
    if (full.startsWith('refs/heads/')) local.push(short);
    else if (full.startsWith('refs/remotes/') && !short.endsWith('/HEAD'))
      remote.push(short);
  }
  return { local: local.sort(), remote: remote.sort() };
}

export async function getRemotes(repoRoot: string): Promise<string[]> {
  const out = await git(repoRoot, ['remote']).catch(() => '');
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function aheadBehind(
  repoRoot: string,
  upstream: string,
  head: string
): Promise<{ ahead: number; behind: number }> {
  try {
    const out = (
      await git(repoRoot, [
        'rev-list',
        '--left-right',
        '--count',
        `${upstream}...${head}`,
      ])
    ).trim();
    const [behind, ahead] = out.split(/\s+/).map((n) => parseInt(n, 10));
    return { ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export async function resolveBase(
  repoRoot: string,
  flag: string | null,
  head: RepoRefs['head'],
  upstreamRemote: string | null
): Promise<RepoRefs['base']> {
  if (flag) {
    const ref = assertRef(flag);
    return { ref, sha: await revParse(repoRoot, ref), source: 'flag' };
  }
  const remote = upstreamRemote || 'origin';
  const remoteHead = (
    await git(repoRoot, [
      'symbolic-ref',
      '--short',
      `refs/remotes/${remote}/HEAD`,
    ]).catch(() => '')
  ).trim();
  const tryLocal = async (
    name: string,
    source: BaseSource
  ): Promise<RepoRefs['base'] | null> => {
    if (head.branch === name) return null;
    const sha = await revParse(repoRoot, name);
    return sha ? { ref: name, sha, source } : null;
  };
  if (remoteHead) {
    const local = remoteHead.split('/').slice(1).join('/');
    const asLocal = local ? await tryLocal(local, 'upstream-base') : null;
    if (asLocal) return asLocal;
    const sha = await revParse(repoRoot, remoteHead);
    if (sha) return { ref: remoteHead, sha, source: 'remote-head' };
  }
  const main = await tryLocal('main', 'main');
  if (main) return main;
  const master = await tryLocal('master', 'master');
  if (master) return master;
  return { ref: 'HEAD', sha: head.sha || null, source: 'head' };
}

export async function mergeBase(
  repoRoot: string,
  a: string,
  b: string
): Promise<string | null> {
  try {
    return (await git(repoRoot, ['merge-base', a, b])).trim() || null;
  } catch {
    return null;
  }
}

export async function remoteBaseRef(
  repoRoot: string,
  remote: string | null,
  base: RepoRefs['base']
): Promise<string | null> {
  if (!remote) return null;
  if (base.ref.startsWith(`${remote}/`)) return base.ref;
  const candidate = `${remote}/${base.ref}`;
  return (await revParse(repoRoot, candidate)) ? candidate : null;
}

export async function lastFetchAt(repoRoot: string): Promise<string | null> {
  try {
    const dir = await gitDir(repoRoot);
    const st = await fs.stat(path.join(dir, 'FETCH_HEAD'));
    return st.mtime.toISOString();
  } catch {
    return null;
  }
}

async function remoteUrl(
  repoRoot: string,
  remote: string | null
): Promise<string | null> {
  if (!remote) return null;
  const out = await git(repoRoot, [
    'config',
    '--get',
    `remote.${remote}.url`,
  ]).catch(() => '');
  return out.trim() || null;
}

export async function getRefs(
  repoRoot: string,
  baseFlag: string | null,
  headRef: string | null = null
): Promise<RepoRefs> {
  const head = await getHead(repoRoot, headRef);
  const headSpec = head.checkedOut ? 'HEAD' : head.sha;
  const [upstream, remotes, fetchedAt] = await Promise.all([
    getUpstream(repoRoot, head.branch),
    getRemotes(repoRoot),
    lastFetchAt(repoRoot),
  ]);
  const base = await resolveBase(
    repoRoot,
    baseFlag,
    head,
    upstream?.remote ?? null
  );
  const url = await remoteUrl(
    repoRoot,
    upstream?.remote ?? remotes[0]?.split('/')[0] ?? null
  );
  const remoteBase = await remoteBaseRef(
    repoRoot,
    upstream?.remote ?? remotes[0] ?? null,
    base
  );
  const mb =
    base.sha && head.sha ? await mergeBase(repoRoot, base.ref, headSpec) : null;
  const counts = upstream
    ? await aheadBehind(repoRoot, upstream.ref, headSpec)
    : null;
  const upstreamMb = upstream
    ? await mergeBase(repoRoot, upstream.ref, headSpec)
    : null;
  const pushedBase =
    upstream && remoteBase
      ? await mergeBase(repoRoot, remoteBase, upstream.ref)
      : null;
  return {
    head,
    base,
    mergeBase: mb,
    upstream:
      upstream && counts
        ? { ...upstream, ...counts, mergeBase: upstreamMb ?? upstream.sha }
        : null,
    remoteBase,
    pushedBase,
    remotes,
    remoteUrl: url,
    lastFetchAt: fetchedAt,
  };
}
