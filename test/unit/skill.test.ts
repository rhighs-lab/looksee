import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKER } from '@/cli/cmd/init.js';
import { CLI_PRESETS } from '@/cli/cmd/session.js';
import { all } from '@/cli/commands.js';
import { packageRoot } from '@/server/pkg-root.js';

const root = packageRoot(import.meta.url);
const file = path.join(root, 'skills', 'looksee', 'SKILL.md');
const read = (): Promise<string> => fs.readFile(file, 'utf8');

const frontmatter = (src: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) throw new Error('SKILL.md has no frontmatter');
  const out: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
};

const invocations = (src: string): string[] =>
  [...src.matchAll(/`?looksee ([a-z ]+?)(?=`|\s--|\s\.|\s<|\n)/g)].map((m) =>
    m[1]!.trim()
  );

describe('looksee skill', () => {
  it('has frontmatter naming the skill looksee', async () => {
    expect(frontmatter(await read())['name']).toBe('looksee');
  });

  it('has a description within the skills length limit', async () => {
    const d = frontmatter(await read())['description']!;
    expect(d.length).toBeGreaterThan(0);
    expect(d.length).toBeLessThanOrEqual(1024);
  });

  it('is shipped in the published package', async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(root, 'package.json'), 'utf8')
    ) as { files: string[] };
    expect(pkg.files).toContain('skills');
  });

  it('only names commands that are registered', async () => {
    const names = new Set(all().map((c) => c.name));
    const named = invocations(await read());
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(names).toContain(n);
  });

  it('names every scope preset the CLI accepts', async () => {
    const src = await read();
    for (const preset of CLI_PRESETS) expect(src).toContain(`\`${preset}\``);
  });

  it('names the listen flags the CLI registers', async () => {
    const listen = all().find((c) => c.name === 'listen')!;
    const flags = new Set(listen.flags.map((f) => f.name));
    const src = await read();
    for (const f of ['not-me', 'pending']) {
      expect(flags).toContain(f);
      expect(src).toContain(`--${f}`);
    }
  });

  it('leaves the AGENTS.md marker to looksee init', async () => {
    expect(await read()).not.toContain(MARKER);
  });
});
