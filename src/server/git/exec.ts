import { execFile } from 'node:child_process';

const MAX_BUFFER = 256 * 1024 * 1024;

export interface GitOpts {
  okCodes?: number[];
  env?: Record<string, string>;
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number | null,
    readonly stderr: string
  ) {
    super(`git ${args.join(' ')} failed: ${stderr.trim() || `exit ${code}`}`);
  }
}

export function git(
  repoRoot: string,
  args: string[],
  opts: GitOpts = {}
): Promise<string> {
  const okCodes = opts.okCodes ?? [0];
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', '-C', repoRoot, ...args],
      { maxBuffer: MAX_BUFFER, env: { ...process.env, ...opts.env } },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
        if (err && !(code !== null && okCodes.includes(code))) {
          reject(new GitError(args, code, String(stderr)));
          return;
        }
        resolve(String(stdout));
      }
    );
  });
}

export function isSafeRef(ref: unknown): ref is string {
  return (
    typeof ref === 'string' &&
    ref.length > 0 &&
    ref.length < 512 &&
    !ref.startsWith('-') &&
    !/[\s:?*[\\\x00-\x1f]/.test(ref) &&
    !ref.includes('..') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.lock') &&
    !ref.includes('@{')
  );
}

export function assertRef(ref: unknown): string {
  if (!isSafeRef(ref)) throw new Error(`invalid ref: ${String(ref)}`);
  return ref;
}

export async function resolveRepoRoot(cwd: string): Promise<string | null> {
  try {
    const out = await git(cwd, ['rev-parse', '--show-toplevel']);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function gitDir(repoRoot: string): Promise<string> {
  const out = (await git(repoRoot, ['rev-parse', '--absolute-git-dir'])).trim();
  return out;
}
