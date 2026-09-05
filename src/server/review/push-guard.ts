import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from '@/server/git/exec.js';
import { ensureExcluded } from '@/server/review/attachments.js';

const MARKER = '# looksee push guard';
const GUARD_FILE = path.join('.looksee', 'push-guard');

const HOOK = `#!/bin/sh
${MARKER}
guard="$(git rev-parse --show-toplevel)/${GUARD_FILE}"
[ -f "$guard" ] || exit 0
[ -n "$LOOKSEE_ALLOW_PUSH" ] && exit 0
branch="$(cat "$guard")"
here="$(git symbolic-ref --quiet --short HEAD || echo)"
[ "$branch" = "$here" ] || exit 0
echo "looksee: a review of $branch is still open." >&2
echo "  looksee review submit --verdict approve   finish it" >&2
echo "  looksee review discard                    throw it away" >&2
echo "  LOOKSEE_ALLOW_PUSH=1 git push ...         push anyway" >&2
exit 1
`;

async function hookPath(repoRoot: string): Promise<string | null> {
  const custom = (
    await git(repoRoot, ['config', '--get', 'core.hooksPath']).catch(() => '')
  ).trim();
  if (custom) return null;
  const gitDir = (
    await git(repoRoot, ['rev-parse', '--absolute-git-dir'])
  ).trim();
  return path.join(gitDir, 'hooks', 'pre-push');
}

const isOurs = async (file: string): Promise<boolean> => {
  const cur = await fs.readFile(file, 'utf8').catch(() => null);
  return cur === null || cur.includes(MARKER);
};

export async function armPushGuard(
  repoRoot: string,
  branch: string | null
): Promise<'armed' | 'hook-taken' | 'no-branch' | 'custom-hooks-path'> {
  if (!branch) return 'no-branch';
  const file = await hookPath(repoRoot);
  if (!file) return 'custom-hooks-path';
  if (!(await isOurs(file))) return 'hook-taken';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, HOOK, { mode: 0o755 });
  await fs.mkdir(path.join(repoRoot, '.looksee'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, GUARD_FILE), `${branch}\n`);
  await ensureExcluded(repoRoot);
  return 'armed';
}

export async function disarmPushGuard(repoRoot: string): Promise<void> {
  await fs.rm(path.join(repoRoot, GUARD_FILE), { force: true });
  const file = await hookPath(repoRoot);
  if (file && (await isOurs(file))) await fs.rm(file, { force: true });
}
