import fs from 'node:fs/promises';
import { git, gitBytes, isSafeRef } from '@/server/git/exec.js';
import { insideRepo, safeRelPath } from '@/server/git/paths.js';
import type { Rev } from '@/shared/protocol.js';

function spec(rev: Rev, rel: string): string | null {
  if (rev === 'INDEX') return `:${rel}`;
  if (!isSafeRef(rev)) return null;
  return `${rev}:${rel}`;
}

export async function getBlobText(
  repoRoot: string,
  rev: Rev,
  filePath: string
): Promise<string> {
  const rel = safeRelPath(filePath);
  if (!rel) return '';
  if (rev === 'WORKTREE') {
    const abs = insideRepo(repoRoot, rel);
    if (!abs) return '';
    return fs.readFile(abs, 'utf8').catch(() => '');
  }
  const s = spec(rev, rel);
  if (!s) return '';
  return git(repoRoot, ['cat-file', 'blob', s]).catch(() => '');
}

export async function getBlobBytes(
  repoRoot: string,
  rev: Rev,
  filePath: string
): Promise<Buffer | null> {
  const rel = safeRelPath(filePath);
  if (!rel) return null;
  if (rev === 'WORKTREE') {
    const abs = insideRepo(repoRoot, rel);
    if (!abs) return null;
    return fs.readFile(abs).catch(() => null);
  }
  const s = spec(rev, rel);
  if (!s) return null;
  return gitBytes(repoRoot, ['cat-file', 'blob', s]).catch(() => null);
}

export async function blobExists(
  repoRoot: string,
  rev: Rev,
  filePath: string
): Promise<boolean> {
  const rel = safeRelPath(filePath);
  if (!rel) return false;
  if (rev === 'WORKTREE') {
    const abs = insideRepo(repoRoot, rel);
    if (!abs) return false;
    return fs
      .stat(abs)
      .then((st) => st.isFile())
      .catch(() => false);
  }
  const s = spec(rev, rel);
  if (!s) return false;
  return git(repoRoot, ['cat-file', '-t', s])
    .then((t) => t.trim() === 'blob')
    .catch(() => false);
}

export function splitLines(content: string): string[] {
  const all = content.split('\n');
  if (all.length && all[all.length - 1] === '') all.pop();
  return all;
}

export async function getLineCount(
  repoRoot: string,
  rev: Rev,
  filePath: string
): Promise<number> {
  return splitLines(await getBlobText(repoRoot, rev, filePath)).length;
}

export async function getBlobLines(
  repoRoot: string,
  rev: Rev,
  filePath: string,
  start: number,
  end: number
): Promise<{ lines: string[]; from: number; eof: boolean }> {
  const all = splitLines(await getBlobText(repoRoot, rev, filePath));
  const from = Math.max(1, start);
  return { lines: all.slice(from - 1, end), from, eof: end >= all.length };
}

export async function getRepoFiles(
  repoRoot: string,
  rev: Rev
): Promise<string[]> {
  let out: string;
  if (rev === 'WORKTREE')
    out = await git(repoRoot, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
  else if (rev === 'INDEX')
    out = await git(repoRoot, ['ls-files', '--cached', '-z']);
  else if (isSafeRef(rev))
    out = await git(repoRoot, ['ls-tree', '-r', '--name-only', '-z', rev]);
  else return [];
  return [...new Set(out.split('\0').filter(Boolean))].sort();
}

export const isBinaryText = (text: string): boolean =>
  text.slice(0, 8192).includes('\0');
