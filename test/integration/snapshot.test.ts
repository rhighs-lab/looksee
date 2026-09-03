import fs from 'node:fs/promises';
import path from 'node:path';
import { makeRepo, type Repo, seedRepo } from '@test/helpers/repo.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBlobText, getLineCount, getRepoFiles } from '@/server/git/blobs.js';
import { treeDiffPatch, treeNameStatus } from '@/server/git/diff.js';
import {
  indexTree,
  pinRef,
  readPin,
  snapshotWorktree,
  treeOf,
  unpinRef,
} from '@/server/git/snapshot.js';

const status = (repo: Repo) => repo.git(['status', '--porcelain=v2', '-z']);
const lsTree = (repo: Repo, tree: string) =>
  repo.git(['ls-tree', '-r', '--name-only', tree]);
const lsIndex = (repo: Repo) => repo.git(['ls-files', '--cached']);

describe('snapshotWorktree', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
    await repo.write('src/format.js', 'export const money = (n) => n;\n');
    await repo.git(['add', 'src/format.js']);
    await repo.write('README.md', '# fixture\n\nmore\n');
    await repo.write('src/new.js', 'export const fresh = 1;\n');
    await repo.write('ignored.log', 'noise\n');
  });
  afterAll(() => repo.cleanup());

  it('leaves git status byte-identical and the real index untouched', async () => {
    const before = await status(repo);
    const tree = await snapshotWorktree(repo.dir);
    expect(tree).toMatch(/^[0-9a-f]{40}$/);
    expect(await status(repo)).toBe(before);
    const files = await lsTree(repo, tree);
    expect(files).toContain('src/new.js');
    expect(files).not.toContain('ignored.log');
    expect(await lsIndex(repo)).not.toContain('src/new.js');
    expect(await getBlobText(repo.dir, tree, 'README.md')).toBe(
      '# fixture\n\nmore\n'
    );
  });

  it('yields the same tree when nothing changed', async () => {
    const a = await snapshotWorktree(repo.dir);
    const b = await snapshotWorktree(repo.dir);
    expect(a).toBe(b);
  });

  it('serves tree oids through the blob helpers', async () => {
    const tree = await snapshotWorktree(repo.dir);
    expect(await getLineCount(repo.dir, tree, 'README.md')).toBe(3);
    const files = await getRepoFiles(repo.dir, tree);
    expect(files).toContain('src/new.js');
    expect(files).toContain('src/cart.js');
    expect(files).not.toContain('ignored.log');
  });

  it('resolves commits and refs to their trees', async () => {
    const head = (await repo.git(['rev-parse', 'HEAD^{tree}'])).trim();
    expect(await treeOf(repo.dir, 'HEAD')).toBe(head);
    expect(await treeOf(repo.dir, 'main')).toBe(head);
    expect(await treeOf(repo.dir, head)).toBe(head);
  });
});

describe('pins', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
  });
  afterAll(() => repo.cleanup());

  it('keep a tree alive across gc and unpin removes the ref', async () => {
    await repo.write('src/tmp.js', 'export const tmp = 1;\n');
    const tree = await snapshotWorktree(repo.dir);
    await repo.rm('src/tmp.js');
    await pinRef(repo.dir, 'k1', 'opened', tree);
    expect(await readPin(repo.dir, 'k1', 'opened')).toBe(tree);
    expect(
      (await repo.git(['rev-parse', 'refs/looksee/k1/opened'])).trim()
    ).toBe(tree);
    await repo.git(['gc', '-q', '--prune=now']);
    expect((await repo.git(['cat-file', '-t', tree])).trim()).toBe('tree');
    await unpinRef(repo.dir, 'k1', 'opened');
    expect(await readPin(repo.dir, 'k1', 'opened')).toBeNull();
    await expect(
      repo.git(['rev-parse', '--verify', '-q', 'refs/looksee/k1/opened'])
    ).rejects.toThrow();
    await unpinRef(repo.dir, 'k1', 'opened');
  });
});

describe('tree to tree diffs', () => {
  let repo: Repo;
  let a: string;
  let b: string;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
    a = await snapshotWorktree(repo.dir);
    await repo.write('src/new.js', 'export const fresh = 1;\n');
    await repo.rm('src/old.js');
    await fs.rename(
      path.join(repo.dir, 'src/cart.js'),
      path.join(repo.dir, 'src/basket.js')
    );
    b = await snapshotWorktree(repo.dir);
  });
  afterAll(() => repo.cleanup());

  it('shows untracked adds, deletions and renames', async () => {
    const patch = await treeDiffPatch(repo.dir, a, b);
    expect(patch).toContain('diff --git a/src/new.js b/src/new.js');
    expect(patch).toContain('new file mode');
    expect(patch).toContain('diff --git a/src/old.js b/src/old.js');
    expect(patch).toContain('deleted file mode');
    expect(patch).toContain('rename from src/cart.js');
    expect(patch).toContain('rename to src/basket.js');
    const ns = await treeNameStatus(repo.dir, a, b);
    expect(ns).toEqual(
      expect.arrayContaining([
        { code: 'A', oldPath: null, path: 'src/new.js' },
        { code: 'D', oldPath: null, path: 'src/old.js' },
        { code: 'R', oldPath: 'src/cart.js', path: 'src/basket.js' },
      ])
    );
  });

  it('limits the patch to the given paths', async () => {
    const patch = await treeDiffPatch(repo.dir, a, b, ['src/new.js']);
    expect(patch).toContain('src/new.js');
    expect(patch).not.toContain('src/old.js');
  });
});

describe('indexTree', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
  });
  afterAll(() => repo.cleanup());

  it('returns the index tree, then null once the index is unmerged', async () => {
    await repo.write('src/new.js', 'export const fresh = 1;\n');
    const before = await status(repo);
    const tree = await indexTree(repo.dir);
    expect(tree).toBe((await repo.git(['rev-parse', 'HEAD^{tree}'])).trim());
    expect(await status(repo)).toBe(before);
    await repo.rm('src/new.js');
    await repo.git(['checkout', '-qb', 'side']);
    await repo.write('README.md', '# side\n');
    await repo.commitAll('side');
    await repo.git(['checkout', '-q', 'main']);
    await repo.write('README.md', '# main\n');
    await repo.commitAll('main');
    await repo.git(['merge', 'side']).catch(() => {});
    expect(await status(repo)).toContain('u UU');
    expect(await indexTree(repo.dir)).toBeNull();
    expect(await snapshotWorktree(repo.dir)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('unborn repo', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await makeRepo();
  });
  afterAll(() => repo.cleanup());

  it('snapshots from an empty tree', async () => {
    await repo.write('a.txt', 'a\n');
    const before = await status(repo);
    const tree = await snapshotWorktree(repo.dir);
    expect(await status(repo)).toBe(before);
    expect(await lsTree(repo, tree)).toContain('a.txt');
    expect(await lsIndex(repo)).toBe('');
  });
});
