import path from 'node:path';

export function safeRelPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const p = path.posix.normalize(raw.replace(/\\/g, '/'));
  if (!p || p === '.' || p.startsWith('/') || p === '..' || p.startsWith('../'))
    return null;
  if (p.includes('\0')) return null;
  return p;
}

export function insideRepo(repoRoot: string, rel: string): string | null {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}
