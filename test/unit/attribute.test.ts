import { describe, expect, it } from 'vitest';
import { attributeFile } from '@/server/git/attribute.js';
import type { DiffLine, FileDiff, Hunk } from '@/shared/protocol.js';

const hunk = (raw: string[]): Hunk => {
  let o = 1;
  let n = 1;
  const lines: DiffLine[] = raw.map((l) => {
    const content = l.slice(1);
    if (l[0] === '+')
      return { type: 'add', oldNumber: null, newNumber: n++, content };
    if (l[0] === '-')
      return { type: 'del', oldNumber: o++, newNumber: null, content };
    return { type: 'context', oldNumber: o++, newNumber: n++, content };
  });
  return {
    header: '@@',
    sectionHeading: '',
    oldStart: 1,
    oldLines: o - 1,
    newStart: 1,
    newLines: n - 1,
    lines,
  };
};

const file = (raw: string[]): FileDiff => ({
  path: 'a.txt',
  oldPath: null,
  kind: 'modified',
  binary: false,
  language: null,
  additions: 0,
  deletions: 0,
  hunks: [hunk(raw)],
  newLineCount: null,
  rev: 'WORKTREE',
  oldRev: 'HEAD',
  digest: 'x',
  truncated: false,
});

const layersOf = (f: FileDiff) => f.hunks[0]!.lines.map((l) => l.layer ?? null);

describe('attributeFile', () => {
  it('matches add and del lines against per-layer multisets, newest first', () => {
    const f = file([' ctx', '+a', '+b', '-c', '+d']);
    attributeFile(
      f,
      [
        { layer: 'unstaged', hunks: [hunk(['+b', '-x'])] },
        { layer: 'staged', hunks: [hunk(['+a', '+x', '-c'])] },
      ],
      'unstaged'
    );
    expect(layersOf(f)).toEqual([
      null,
      'staged',
      'unstaged',
      'staged',
      'unstaged',
    ]);
  });

  it('consumes duplicates once per occurrence and ignores trailing space', () => {
    const f = file(['+b  ', '+b', '+b']);
    attributeFile(
      f,
      [
        { layer: 'unstaged', hunks: [hunk(['+b'])] },
        { layer: 'staged', hunks: [hunk(['+b '])] },
        { layer: 'local', hunks: [hunk(['+b'])] },
      ],
      'pushed'
    );
    expect(layersOf(f)).toEqual(['unstaged', 'staged', 'local']);
  });

  it('leaves lines unattributed when nothing matches and no fallback', () => {
    const f = file(['+a']);
    attributeFile(f, [], null);
    expect(layersOf(f)).toEqual([null]);
  });
});
