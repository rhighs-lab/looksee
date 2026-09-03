import { describe, expect, it } from 'vitest';
import { inferLanguage, parsePatch } from '@/server/git/diff-parser.js';

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@ export function f() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export {};
`;

const ADDED = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
\\ No newline at end of file
`;

const DELETED = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index e69de29..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;

const RENAMED = `diff --git a/docs/OLD.md b/docs/new.md
similarity index 80%
rename from docs/OLD.md
rename to docs/new.md
index 1..2 100644
--- a/docs/OLD.md
+++ b/docs/new.md
@@ -1 +1 @@
-# Old
+# New
`;

const BINARY = `diff --git a/img.png b/img.png
index 1..2 100644
Binary files a/img.png and b/img.png differ
`;

const COMBINED = `diff --cc src/conflict.js
index 1111111,2222222..0000000
--- a/src/conflict.js
+++ b/src/conflict.js
@@@ -1,2 -1,2 +1,6 @@@
++<<<<<<< HEAD
 +ours
++=======
+ theirs
++>>>>>>> branch
`;

describe('parsePatch', () => {
  it('parses a modified file with counts and line numbers', () => {
    const [f] = parsePatch(MODIFIED);
    expect(f).toMatchObject({
      path: 'src/a.ts',
      kind: 'modified',
      additions: 2,
      deletions: 1,
      language: 'typescript',
    });
    const lines = f!.hunks[0]!.lines;
    expect(lines.map((l) => l.type)).toEqual([
      'context',
      'del',
      'add',
      'add',
      'context',
    ]);
    expect(lines[4]).toMatchObject({ oldNumber: 3, newNumber: 4 });
    expect(f!.hunks[0]!.sectionHeading).toBe('export function f() {');
  });

  it('classifies added, deleted, renamed and binary files', () => {
    const files = parsePatch(ADDED + DELETED + RENAMED + BINARY);
    expect(files.map((f) => [f.path, f.kind, f.oldPath])).toEqual([
      ['new.txt', 'added', null],
      ['gone.txt', 'deleted', null],
      ['docs/new.md', 'renamed', 'docs/OLD.md'],
      ['img.png', 'modified', null],
    ]);
    expect(files[3]!.binary).toBe(true);
    expect(files[0]!.hunks[0]!.lines).toHaveLength(2);
  });

  it('skips combined (diff --cc) sections instead of leaking their lines into the previous file', () => {
    const files = parsePatch(MODIFIED + COMBINED);
    expect(files).toHaveLength(1);
    expect(files[0]!.additions).toBe(2);
  });

  it('gives each file a stable digest that changes with content', () => {
    const [a] = parsePatch(MODIFIED);
    const [b] = parsePatch(MODIFIED);
    const [c] = parsePatch(MODIFIED.replace('const c = 4', 'const c = 5'));
    expect(a!.digest).toBe(b!.digest);
    expect(a!.digest).not.toBe(c!.digest);
  });

  it('infers languages', () => {
    expect(inferLanguage('Dockerfile')).toBe('docker');
    expect(inferLanguage('x/y.tsx')).toBe('tsx');
    expect(inferLanguage('noext')).toBeNull();
    expect(inferLanguage(null)).toBeNull();
  });
});
