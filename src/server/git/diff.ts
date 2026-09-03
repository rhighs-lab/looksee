import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git, isSafeRef } from '@/server/git/exec.js';
import { insideRepo } from '@/server/git/paths.js';
import type { Rev } from '@/shared/protocol.js';

export const DIFF_FLAGS = [
  '--no-color',
  '--find-renames',
  '--find-copies',
  '--no-ext-diff',
];

export interface DiffSpec {
  from: Rev;
  to: Rev;
}

function refArg(rev: Rev): string {
  if (rev === 'WORKTREE' || rev === 'INDEX')
    throw new Error(`not a ref: ${rev}`);
  if (!isSafeRef(rev)) throw new Error(`invalid ref: ${rev}`);
  return rev;
}

export async function diffPatch(
  repoRoot: string,
  spec: DiffSpec,
  paths: string[] = []
): Promise<string> {
  const scope = paths.length ? ['--', ...paths] : [];
  const { from, to } = spec;
  if (from === 'INDEX' && to === 'WORKTREE')
    return git(repoRoot, ['diff', ...DIFF_FLAGS, ...scope]);
  if (to === 'INDEX')
    return git(repoRoot, [
      'diff',
      ...DIFF_FLAGS,
      '--cached',
      refArg(from),
      ...scope,
    ]);
  if (to === 'WORKTREE')
    return git(repoRoot, ['diff', ...DIFF_FLAGS, refArg(from), ...scope]);
  return git(repoRoot, [
    'diff',
    ...DIFF_FLAGS,
    refArg(from),
    refArg(to),
    ...scope,
  ]);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return out;
}

export async function untrackedPatch(
  repoRoot: string,
  files: string[]
): Promise<string> {
  const patches = await mapLimit(files, 8, (file) =>
    git(
      repoRoot,
      ['diff', ...DIFF_FLAGS, '--no-index', '--', '/dev/null', file],
      { okCodes: [0, 1] }
    ).catch(() => '')
  );
  return patches.join('');
}

export async function listUntracked(repoRoot: string): Promise<string[]> {
  const out = await git(repoRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  return out.split('\0').filter(Boolean);
}

async function tmpFileFor(
  repoRoot: string,
  rev: string,
  rel: string
): Promise<string | null> {
  const blob = await git(repoRoot, ['cat-file', 'blob', `${rev}:${rel}`]).catch(
    () => null
  );
  if (blob === null) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-conflict-'));
  const p = path.join(dir, path.basename(rel));
  await fs.writeFile(p, blob);
  return p;
}

function rewriteNoIndexHeader(
  patch: string,
  tmp: string,
  abs: string,
  rel: string
): string {
  const lines = patch.split('\n');
  return lines
    .map((l) => {
      if (l.startsWith('diff --git ')) return `diff --git a/${rel} b/${rel}`;
      if (l.startsWith('--- ') && l.includes(tmp)) return `--- a/${rel}`;
      if (l.startsWith('+++ ') && l.includes(abs)) return `+++ b/${rel}`;
      return l;
    })
    .join('\n');
}

export async function conflictPatch(
  repoRoot: string,
  base: string,
  files: string[]
): Promise<string> {
  const out: string[] = [];
  for (const rel of files) {
    const abs = insideRepo(repoRoot, rel);
    if (!abs) continue;
    const tmp = await tmpFileFor(repoRoot, base, rel);
    const left = tmp ?? '/dev/null';
    const patch = await git(
      repoRoot,
      ['diff', ...DIFF_FLAGS, '--no-index', '--', left, abs],
      { okCodes: [0, 1] }
    ).catch(() => '');
    if (tmp) await fs.rm(path.dirname(tmp), { recursive: true, force: true });
    if (patch)
      out.push(
        tmp
          ? rewriteNoIndexHeader(patch, tmp, abs, rel)
          : rewriteNoIndexHeader(patch, '/dev/null', abs, rel)
      );
  }
  return out.join('');
}

export interface NameStatus {
  path: string;
  oldPath: string | null;
  code: string;
}

export async function nameStatus(
  repoRoot: string,
  from: string,
  to: string
): Promise<NameStatus[]> {
  const out = await git(repoRoot, [
    'diff',
    '--name-status',
    '--find-renames',
    '--find-copies',
    '-z',
    refArg(from),
    refArg(to),
  ]);
  const parts = out.split('\0');
  const res: NameStatus[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!code) continue;
    const c = code[0]!;
    if (c === 'R' || c === 'C') {
      res.push({
        code: c,
        oldPath: parts[i + 1] ?? null,
        path: parts[i + 2] ?? '',
      });
      i += 2;
    } else {
      res.push({ code: c, oldPath: null, path: parts[i + 1] ?? '' });
      i += 1;
    }
  }
  return res.filter((r) => r.path);
}

export const digestOf = (text: string): string =>
  crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
