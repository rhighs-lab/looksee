import { describe, expect, it } from 'vitest';
import { isStaged, isUnstaged, parseStatus } from '@/server/git/status.js';

const z = (...recs: string[]) => `${recs.join('\0')}\0`;

describe('parseStatus (porcelain v2, -z)', () => {
  it('parses ordinary, renamed, unmerged, untracked and ignored entries', () => {
    const text = z(
      '1 .M N... 100644 100644 100644 abc def src/a.js',
      '1 M. N... 100644 100644 100644 abc def src/b.js',
      '1 MM N... 100644 100644 100644 abc def src/c.js',
      '2 R. N... 100644 100644 100644 abc def R100 src/new.js',
      'src/old.js',
      'u UU N... 100644 100644 100644 100644 a b c src/conflict.js',
      '? new.txt',
      '! ignored.log'
    );
    const entries = parseStatus(text);
    expect(entries.map((e) => e.path)).toEqual([
      'src/a.js',
      'src/b.js',
      'src/c.js',
      'src/new.js',
      'src/conflict.js',
      'new.txt',
      'ignored.log',
    ]);
    const [a, b, c, r, u, n, ig] = entries;
    expect(isStaged(a!)).toBe(false);
    expect(isUnstaged(a!)).toBe(true);
    expect(isStaged(b!)).toBe(true);
    expect(isUnstaged(b!)).toBe(false);
    expect(isStaged(c!) && isUnstaged(c!)).toBe(true);
    expect(r!.origPath).toBe('src/old.js');
    expect(r!.index).toBe('R');
    expect(u!.unmerged).toBe(true);
    expect(isStaged(u!)).toBe(false);
    expect(n!.untracked).toBe(true);
    expect(ig!.ignored).toBe(true);
  });

  it('keeps paths containing spaces', () => {
    const [e] = parseStatus(
      z('1 .M N... 100644 100644 100644 abc def dir with space/file name.txt')
    );
    expect(e!.path).toBe('dir with space/file name.txt');
  });

  it('returns an empty list for empty output', () => {
    expect(parseStatus('')).toEqual([]);
  });
});
