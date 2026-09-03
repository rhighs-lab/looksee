import { readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { serve } from '@hono/node-server';
import open from 'open';
import { createApp } from '@/server/app.js';
import { resolveRepoRoot } from '@/server/git/exec.js';
import { packageRoot } from '@/server/pkg-root.js';

const pkgRoot = packageRoot(import.meta.url);
const VERSION = (
  JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

interface Opts {
  repoPath: string;
  base: string | null;
  port: number | null;
  open: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    repoPath: process.cwd(),
    base: null,
    port: null,
    open: true,
    help: false,
    version: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--base') opts.base = argv[++i] ?? null;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--no-open') opts.open = false;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--version' || a === '-v' || a === '-V') opts.version = true;
    else if (!a.startsWith('-')) positional.push(a);
  }
  if (positional[0]) opts.repoPath = positional[0];
  return opts;
}

const HELP = `looksee — local GitHub-style review of uncommitted work

Usage:
  looksee [repoPath] [--base <ref>] [--port <n>] [--no-open]

  repoPath   Path to the git repo (default: current directory)
  --base     Base ref to diff against (default: the remote default branch, then main/master)
  --port     Port to listen on (default: first free from 4711)
  --no-open  Don't auto-open the browser
  --version  Print the installed version and exit
`;

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', () => findFreePort(start + 1).then(resolve, reject));
    srv.once('listening', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : start;
      srv.close(() => resolve(port));
    });
    srv.listen(start, '127.0.0.1');
  });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const opts = parseArgs(argv);
  if (opts.version) return void process.stdout.write(`${VERSION}\n`);
  if (opts.help) return void process.stdout.write(HELP);

  const repoRoot = await resolveRepoRoot(opts.repoPath);
  const clientDir = path.join(pkgRoot, 'dist', 'client');
  const looksee = createApp({ repoRoot, defaultBase: opts.base, clientDir });
  await looksee.start();
  const port = opts.port || (await findFreePort(4711));
  serve({ fetch: looksee.app.fetch, hostname: '127.0.0.1', port }, async () => {
    const url = `http://127.0.0.1:${port}`;
    process.stdout.write(`\n  looksee running at ${url}\n`);
    process.stdout.write(
      `  repo: ${repoRoot ?? opts.repoPath}${repoRoot ? '' : '  (not a git repo — showing sample diff)'}\n`
    );
    process.stdout.write('  Ctrl-C to stop\n');
    process.stdout.write('\n');
    if (opts.open) await open(url).catch(() => {});
  });
  const shutdown = () => {
    looksee.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
