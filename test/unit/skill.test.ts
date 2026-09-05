import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageRoot } from '@/server/pkg-root.js';

const root = packageRoot(import.meta.url);
const file = path.join(root, 'skills', 'looksee', 'SKILL.md');

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

describe('looksee skill', () => {
  it('has frontmatter naming the skill looksee', async () => {
    const fm = frontmatter(await fs.readFile(file, 'utf8'));
    expect(fm['name']).toBe('looksee');
  });

  it('has a description within the skills length limit', async () => {
    const fm = frontmatter(await fs.readFile(file, 'utf8'));
    expect(fm['description']!.length).toBeGreaterThan(0);
    expect(fm['description']!.length).toBeLessThanOrEqual(1024);
  });

  it('is shipped in the published package', async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(root, 'package.json'), 'utf8')
    ) as { files: string[] };
    expect(pkg.files).toContain('skills');
  });

  it('names every scope preset the CLI accepts', async () => {
    const src = await fs.readFile(file, 'utf8');
    for (const preset of ['session', 'working', 'branch'])
      expect(src).toContain(`\`${preset}\``);
  });

  it('names commands and flags that exist', async () => {
    const src = await fs.readFile(file, 'utf8');
    expect(src).toContain('looksee listen --not-me --pending');
    expect(src).toContain('looksee review . --scope');
    expect(src).toContain('looksee init');
    expect(src).toContain('looksee agent');
  });
});
