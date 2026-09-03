import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertRef, git } from '@/server/git/exec.js';

const NO_GC = ['-c', 'gc.auto=0'];

const pinName = (key: string, name: string): string =>
  `refs/looksee/${key}/${name}`;

export async function snapshotWorktree(repoRoot: string): Promise<string> {
  const idx = path.join(
    os.tmpdir(),
    `looksee-index-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  );
  const env = { GIT_INDEX_FILE: idx };
  try {
    const head = await git(repoRoot, ['rev-parse', '-q', '--verify', 'HEAD'], {
      okCodes: [0, 1],
    });
    if (head.trim())
      await git(repoRoot, [...NO_GC, 'read-tree', 'HEAD'], { env });
    await git(repoRoot, [...NO_GC, 'add', '-A'], { env });
    return (await git(repoRoot, [...NO_GC, 'write-tree'], { env })).trim();
  } finally {
    await fs.rm(idx, { force: true });
    await fs.rm(`${idx}.lock`, { force: true });
  }
}

export async function indexTree(repoRoot: string): Promise<string | null> {
  try {
    return (await git(repoRoot, [...NO_GC, 'write-tree'])).trim();
  } catch {
    return null;
  }
}

export async function treeOf(repoRoot: string, rev: string): Promise<string> {
  const out = await git(repoRoot, [
    'rev-parse',
    '--verify',
    `${assertRef(rev)}^{tree}`,
  ]);
  return out.trim();
}

export async function pinRef(
  repoRoot: string,
  key: string,
  name: string,
  tree: string
): Promise<void> {
  await git(repoRoot, ['update-ref', pinName(key, name), assertRef(tree)]);
}

export async function unpinRef(
  repoRoot: string,
  key: string,
  name: string
): Promise<void> {
  await git(repoRoot, ['update-ref', '-d', pinName(key, name)]);
}

export async function readPin(
  repoRoot: string,
  key: string,
  name: string
): Promise<string | null> {
  const out = await git(
    repoRoot,
    ['rev-parse', '-q', '--verify', pinName(key, name)],
    { okCodes: [0, 1] }
  );
  return out.trim() || null;
}
