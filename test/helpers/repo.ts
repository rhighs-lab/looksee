import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ID = [
  '-c',
  'user.name=fixture',
  '-c',
  'user.email=fixture@example.com',
  '-c',
  'commit.gpgsign=false',
];

export function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', [...ID, '-C', dir, ...args], (err, stdout, stderr) => {
      if (err)
        reject(
          new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`)
        );
      else resolve(stdout);
    });
  });
}

export interface Repo {
  dir: string;
  remote: string | null;
  write(rel: string, content: string): Promise<void>;
  rm(rel: string): Promise<void>;
  git(args: string[]): Promise<string>;
  commitAll(msg: string): Promise<void>;
  cleanup(): Promise<void>;
}

export function padLines(head: string[], n: number): string {
  const out = [...head];
  for (let i = out.length + 1; i <= n; i++) out.push(`// line ${i}`);
  return `${out.join('\n')}\n`;
}

export async function makeRepo(
  opts: { remote?: boolean; branch?: string } = {}
): Promise<Repo> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-'));
  const dir = path.join(root, 'work');
  await fs.mkdir(dir);
  await git(dir, ['init', '-q', '-b', 'main']);
  let remote: string | null = null;
  if (opts.remote) {
    remote = path.join(root, 'remote.git');
    await git(root, ['init', '-q', '--bare', '-b', 'main', remote]);
    await git(dir, ['remote', 'add', 'origin', remote]);
  }
  const repo: Repo = {
    dir,
    remote,
    write: async (rel, content) => {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), content);
    },
    rm: (rel) => fs.rm(path.join(dir, rel), { force: true }),
    git: (args) => git(dir, args),
    commitAll: async (msg) => {
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-qm', msg]);
    },
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
  return repo;
}

export async function seedRepo(repo: Repo): Promise<void> {
  await repo.write(
    'src/cart.js',
    padLines(
      ['export function total(items) {', '  return items.length;', '}'],
      40
    )
  );
  await repo.write('src/format.js', 'export const money = (n) => `$${n}`;\n');
  await repo.write('src/old.js', 'export const gone = true;\n');
  await repo.write('README.md', '# fixture\n');
  await repo.write('.gitignore', 'ignored.log\n');
  await fs.writeFile(
    path.join(repo.dir, 'img.bin'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 0, 0])
  );
  await repo.commitAll('init');
  if (repo.remote) {
    await repo.git(['push', '-q', '-u', 'origin', 'main']);
    await repo.git(['remote', 'set-head', 'origin', 'main']);
  }
}

export async function featureBranchWithLayers(repo: Repo): Promise<void> {
  await repo.git(['checkout', '-qb', 'feature/x']);
  await repo.write(
    'src/cart.js',
    padLines(
      [
        'const TAX = 0.22;',
        'export function total(items) {',
        '  return items.length * (1 + TAX);',
        '}',
      ],
      40
    )
  );
  await repo.git(['rm', '-q', 'src/old.js']);
  await repo.commitAll('tax and remove old');
  if (repo.remote) await repo.git(['push', '-q', '-u', 'origin', 'feature/x']);
  await repo.write('src/local.js', 'export const local = 1;\n');
  await repo.commitAll('local only commit');
  await repo.write(
    'src/format.js',
    'export const money = (n, cur = "USD") => `${cur} ${n}`;\n'
  );
  await repo.git(['add', 'src/format.js']);
  await repo.write('README.md', '# fixture\n\nmore\n');
  await repo.write(
    'src/index.js',
    'import { total } from "@test/helpers/cart.js";\nconsole.log(total([]));\n'
  );
  await repo.write('ignored.log', 'noise\n');
}
