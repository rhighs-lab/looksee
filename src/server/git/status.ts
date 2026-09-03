import type { ChangeKind } from '@/shared/protocol.js';

export interface StatusEntry {
  path: string;
  origPath: string | null;
  index: string;
  worktree: string;
  untracked: boolean;
  ignored: boolean;
  unmerged: boolean;
  submodule: boolean;
}

function code(c: string): ChangeKind {
  switch (c) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typechange';
    case 'U':
      return 'unmerged';
    default:
      return 'modified';
  }
}

export const kindFromCode = code;

export function parseStatus(text: string): StatusEntry[] {
  const parts = text.split('\0');
  const out: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const tag = rec[0];
    if (tag === '?' || tag === '!') {
      out.push({
        path: rec.slice(2),
        origPath: null,
        index: '.',
        worktree: '.',
        untracked: tag === '?',
        ignored: tag === '!',
        unmerged: false,
        submodule: false,
      });
      continue;
    }
    if (tag === '1' || tag === '2' || tag === 'u') {
      const fields = rec.split(' ');
      const xy = fields[1] ?? '..';
      const sub = fields[2] ?? 'N...';
      const fixed = tag === '1' ? 8 : tag === '2' ? 9 : 10;
      const p = fields.slice(fixed).join(' ');
      let origPath: string | null = null;
      if (tag === '2') {
        origPath = parts[i + 1] ?? null;
        i++;
      }
      out.push({
        path: p,
        origPath,
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.',
        untracked: false,
        ignored: false,
        unmerged: tag === 'u',
        submodule: sub[0] === 'S',
      });
    }
  }
  return out;
}

export const isStaged = (e: StatusEntry): boolean =>
  !e.unmerged && !e.untracked && e.index !== '.';
export const isUnstaged = (e: StatusEntry): boolean =>
  !e.unmerged && !e.untracked && e.worktree !== '.';
