import {
  featureBranchWithLayers,
  makeRepo,
  padLines,
  type Repo,
  seedRepo,
} from '@test/helpers/repo.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePatch } from '@/server/git/diff-parser.js';
import {
  computeRepoState,
  readStatus,
  scopePatch,
} from '@/server/git/state.js';

const state = (repo: Repo, base: string | null = null) =>
  computeRepoState(repo.dir, { baseFlag: base }, 1);

describe('repo state with a remote', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await makeRepo({ remote: true });
    await seedRepo(repo);
    await featureBranchWithLayers(repo);
  });
  afterAll(() => repo.cleanup());

  it('resolves refs, upstream and ahead/behind without fetching', async () => {
    const s = await state(repo);
    expect(s.refs?.head.branch).toBe('feature/x');
    expect(s.refs?.base).toMatchObject({
      ref: 'main',
      source: 'upstream-base',
    });
    expect(s.refs?.upstream).toMatchObject({
      ref: 'origin/feature/x',
      remote: 'origin',
      ahead: 1,
      behind: 0,
    });
    expect(s.refs?.remoteBase).toBe('origin/main');
    expect(
      typeof s.refs?.lastFetchAt === 'string' || s.refs?.lastFetchAt === null
    ).toBe(true);
  });

  it('assigns every file its layers', async () => {
    const s = await state(repo);
    const layers = Object.fromEntries(
      s.files.map((f) => [f.path, f.layers.map((l) => l.layer)])
    );
    expect(layers['src/cart.js']).toEqual(['pushed']);
    expect(layers['src/old.js']).toEqual(['pushed']);
    expect(layers['src/local.js']).toEqual(['local']);
    expect(layers['src/format.js']).toEqual(['staged']);
    expect(layers['README.md']).toEqual(['unstaged']);
    expect(layers['src/index.js']).toEqual(['untracked']);
    expect(layers['ignored.log']).toBeUndefined();
    expect(s.summary.byLayer).toMatchObject({
      pushed: 2,
      local: 1,
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicted: 0,
    });
    expect(s.files.find((f) => f.path === 'src/old.js')?.kind).toBe('deleted');
  });

  it('isolates each layer as its own patch', async () => {
    const s = await state(repo);
    const status = await readStatus(repo.dir);
    const paths = async (scope: Parameters<typeof scopePatch>[1]) =>
      parsePatch(await scopePatch(repo.dir, scope, s.refs!, status))
        .map((f) => f.path)
        .sort();
    expect(await paths('pushed')).toEqual(['src/cart.js', 'src/old.js']);
    expect(await paths('local')).toEqual(['src/local.js']);
    expect(await paths('staged')).toEqual(['src/format.js']);
    expect(await paths('unstaged')).toEqual(['README.md']);
    expect(await paths('untracked')).toEqual(['src/index.js']);
    expect(await paths('conflicted')).toEqual([]);
    expect(await paths('cumulative')).toEqual([
      'README.md',
      'src/cart.js',
      'src/format.js',
      'src/index.js',
      'src/local.js',
      'src/old.js',
    ]);
  });

  it('tracks a file staged and edited again as both staged and unstaged', async () => {
    await repo.write(
      'src/format.js',
      'export const money = (n, cur = "EUR") => `${cur} ${n}`;\n'
    );
    const s = await state(repo);
    expect(
      s.files
        .find((f) => f.path === 'src/format.js')
        ?.layers.map((l) => l.layer)
    ).toEqual(['staged', 'unstaged']);
  });

  it('reflects rapid successive edits in the digest', async () => {
    const before = (await state(repo)).files.find(
      (f) => f.path === 'README.md'
    )!.digest;
    await repo.write('README.md', '# fixture\n\nmore\nagain\n');
    await repo.write('README.md', '# fixture\n\nmore\nagain and again\n');
    const after = (await state(repo)).files.find(
      (f) => f.path === 'README.md'
    )!.digest;
    expect(after).not.toBe(before);
  });

  it('marks pushed commits behind the remote when the remote moves', async () => {
    await repo.git(['fetch', '-q', 'origin']);
    const other = await makeRepo();
    try {
      await other.git(['remote', 'add', 'origin', repo.remote!]);
      await other.git(['fetch', '-q', 'origin']);
      await other.git(['checkout', '-qb', 'feature/x', 'origin/feature/x']);
      await other.write('remote-only.txt', 'r\n');
      await other.commitAll('remote moved');
      await other.git(['push', '-q', 'origin', 'feature/x']);
    } finally {
      await other.cleanup();
    }
    await repo.git(['fetch', '-q', 'origin']);
    const s = await state(repo);
    expect(s.refs?.upstream).toMatchObject({ ahead: 1, behind: 1 });
    expect(s.refs?.lastFetchAt).not.toBeNull();
    expect(s.files.find((f) => f.path === 'remote-only.txt')).toBeUndefined();
  });
});

describe('repo state without a remote', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
    await featureBranchWithLayers(repo);
  });
  afterAll(() => repo.cleanup());

  it('has no upstream, no pushed layer, and local commits vs main', async () => {
    const s = await state(repo);
    expect(s.refs?.upstream).toBeNull();
    expect(s.refs?.remoteBase).toBeNull();
    expect(s.refs?.base).toMatchObject({ ref: 'main', source: 'main' });
    expect(s.refs?.lastFetchAt).toBeNull();
    const layers = Object.fromEntries(
      s.files.map((f) => [f.path, f.layers.map((l) => l.layer)])
    );
    expect(layers['src/cart.js']).toEqual(['local']);
    expect(layers['src/local.js']).toEqual(['local']);
    expect(s.summary.byLayer.pushed).toBe(0);
  });

  it('honors an explicit base and rejects flag-like bases', async () => {
    const s = await state(repo, 'HEAD~1');
    expect(s.refs?.base).toMatchObject({ ref: 'HEAD~1', source: 'flag' });
    await expect(state(repo, '--output=x')).rejects.toThrow(/invalid ref/);
  });
});

describe('renames and conflicts', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await makeRepo();
    await seedRepo(repo);
  });
  afterAll(() => repo.cleanup());

  it('reports a staged rename with its old path', async () => {
    await repo.git(['checkout', '-qb', 'feature/rename']);
    await repo.git(['mv', 'src/format.js', 'src/money.js']);
    const s = await state(repo);
    const f = s.files.find((x) => x.path === 'src/money.js');
    expect(f).toMatchObject({ kind: 'renamed', oldPath: 'src/format.js' });
    expect(f?.layers).toEqual([
      { layer: 'staged', kind: 'renamed', oldPath: 'src/format.js' },
    ]);
    await repo.git(['reset', '-q', '--hard']);
    await repo.git(['checkout', '-q', 'main']);
  });

  it('surfaces a merge conflict as its own layer with the marker diff', async () => {
    await repo.git(['checkout', '-qb', 'feature/conflict']);
    await repo.write(
      'src/cart.js',
      padLines(
        ['export function total(items) {', '  return items.length * 2;', '}'],
        40
      )
    );
    await repo.commitAll('double');
    await repo.git(['checkout', '-q', 'main']);
    await repo.write(
      'src/cart.js',
      padLines(
        ['export function total(items) {', '  return items.length * 3;', '}'],
        40
      )
    );
    await repo.commitAll('triple');
    await repo.git(['checkout', '-q', 'feature/conflict']);
    await repo.git(['merge', 'main']).catch(() => {});
    const s = await state(repo);
    const f = s.files.find((x) => x.path === 'src/cart.js');
    expect(f?.kind).toBe('unmerged');
    expect(f?.layers.map((l) => l.layer)).toContain('conflicted');
    expect(s.summary.byLayer.conflicted).toBe(1);
    const status = await readStatus(repo.dir);
    const patch = await scopePatch(repo.dir, 'conflicted', s.refs!, status);
    expect(patch).toMatch(/\+<<<<<<< HEAD/);
    expect(parsePatch(patch)[0]?.path).toBe('src/cart.js');
    const cumulative = parsePatch(
      await scopePatch(repo.dir, 'cumulative', s.refs!, status)
    );
    expect(cumulative.filter((x) => x.path === 'src/cart.js')).toHaveLength(1);
    await repo.git(['merge', '--abort']);
  });
});
