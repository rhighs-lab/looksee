import { describe, expect, it } from 'vitest';
import { parsePatch } from '@/server/git/diff-parser.js';
import { isSafeRef } from '@/server/git/exec.js';
import {
  composeFiles,
  layersInComparison,
  summarize,
} from '@/server/git/state.js';
import { parseStatus } from '@/server/git/status.js';
import type {
  Endpoint,
  Layer,
  RepoRefs,
  ResolvedComparison,
} from '@/shared/protocol.js';

const z = (...recs: string[]) => `${recs.join('\0')}\0`;

const PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1 +1 @@
-a
+b
diff --git a/src/staged.js b/src/staged.js
--- a/src/staged.js
+++ b/src/staged.js
@@ -1 +1 @@
-x
+y
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+n
`;

describe('composeFiles', () => {
  it('attaches every layer a file participates in', () => {
    const status = parseStatus(
      z(
        '1 .M N... 100644 100644 100644 a b src/a.js',
        '1 M. N... 100644 100644 100644 a b src/staged.js',
        '? new.txt',
        'u UU N... 100644 100644 100644 100644 a b c src/conflict.js'
      )
    );
    const files = composeFiles(
      parsePatch(PATCH),
      status,
      [{ path: 'src/a.js', oldPath: null, code: 'M' }],
      [
        { path: 'src/a.js', oldPath: null, code: 'M' },
        { path: 'src/only-pushed.js', oldPath: null, code: 'A' },
      ]
    );
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath['src/a.js']!.layers.map((l) => l.layer)).toEqual([
      'pushed',
      'local',
      'unstaged',
    ]);
    expect(byPath['src/staged.js']!.layers.map((l) => l.layer)).toEqual([
      'staged',
    ]);
    expect(byPath['new.txt']!.layers.map((l) => l.layer)).toEqual([
      'untracked',
    ]);
    expect(byPath['src/conflict.js']).toMatchObject({
      kind: 'unmerged',
      layers: [{ layer: 'conflicted' }],
    });
    expect(byPath['src/only-pushed.js']).toBeUndefined();
    const s = summarize(files);
    expect(s.byLayer).toMatchObject({
      pushed: 1,
      local: 1,
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicted: 1,
    });
    expect(s.additions).toBe(3);
  });

  it('reports a file with layer activity but no net change as unchanged', () => {
    const status = parseStatus(
      z('1 MM N... 100644 100644 100644 a b src/net-zero.js')
    );
    const [f] = composeFiles([], status, [], []);
    expect(f).toMatchObject({
      path: 'src/net-zero.js',
      kind: 'unchanged',
      additions: 0,
    });
    expect(f!.layers.map((l) => l.layer)).toEqual(['staged', 'unstaged']);
  });

  it('drops layers the comparison does not cover', () => {
    const status = parseStatus(
      z(
        '1 .M N... 100644 100644 100644 a b src/a.js',
        '1 M. N... 100644 100644 100644 a b src/staged.js'
      )
    );
    const files = composeFiles(
      parsePatch(PATCH),
      status,
      [{ path: 'src/local-only.js', oldPath: null, code: 'M' }],
      [],
      new Set<Layer>(['staged', 'unstaged', 'untracked', 'conflicted'])
    );
    expect(files.some((f) => f.path === 'src/local-only.js')).toBe(false);
    expect(summarize(files).byLayer.local).toBe(0);
  });
});

describe('layersInComparison', () => {
  const refs = { head: { sha: 'headsha' } } as RepoRefs;
  const cmp = (
    baseline: [Endpoint['kind'], string],
    endpoint: Endpoint['kind']
  ) =>
    ({
      baseline: { kind: baseline[0], commit: baseline[1], oid: 'tree' },
      endpoint: { kind: endpoint, commit: null, oid: 'x' },
    }) as ResolvedComparison;

  it('drops the commit layers when the baseline is HEAD', () => {
    expect([
      ...layersInComparison(cmp(['head', 'headsha'], 'worktree'), refs),
    ]).toEqual(['staged', 'unstaged', 'untracked', 'conflicted']);
  });

  it('keeps every layer when the baseline is an older commit', () => {
    const got = layersInComparison(
      cmp(['merge-base', 'base'], 'worktree'),
      refs
    );
    expect(got.has('local')).toBe(true);
    expect(got.has('staged')).toBe(true);
    expect(got.has('unstaged')).toBe(true);
  });

  it('stops at the index when the endpoint is the index', () => {
    const got = layersInComparison(cmp(['head', 'headsha'], 'index'), refs);
    expect([...got]).toEqual(['staged']);
  });
});

describe('isSafeRef', () => {
  it('rejects flag-like and shell-ish refs', () => {
    for (const bad of [
      '--output=x',
      '-x',
      'a b',
      'a..b',
      'HEAD@{1}',
      '',
      'a\nb',
      'a/',
      'a:b',
    ])
      expect(isSafeRef(bad)).toBe(false);
    for (const ok of [
      'main',
      'origin/main',
      'feature/x-1',
      'v1.2.3',
      'abc123',
      'HEAD~1',
      'main^2',
    ])
      expect(isSafeRef(ok)).toBe(true);
  });
});
