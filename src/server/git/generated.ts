const NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'go.sum',
  'flake.lock',
]);

const DIRS =
  /(^|\/)(dist|build|out|vendor|node_modules|__snapshots__|coverage)\//;
const EXT = /\.(min\.(js|css)|map|snap|pb\.go|generated\.(ts|js)|d\.ts)$/;

export function isGeneratedPath(p: string): boolean {
  const base = (p.split('/').pop() ?? '').toLowerCase();
  return NAMES.has(base) || DIRS.test(p) || EXT.test(p);
}
