import { describe, expect, it } from 'vitest';
import {
  highlightLines,
  highlightStylesheet,
  highlightStylesVersion,
} from '@/server/render/highlighter.js';

describe('highlightLines', () => {
  it('shares token styles through classes and a stylesheet', async () => {
    const before = highlightStylesVersion();
    const [line] = (await highlightLines(
      ['const total = x * 2;'],
      'typescript',
      'classed'
    ))!;
    expect(line).not.toContain('style=');
    const ids = [...line!.matchAll(/class="tok (t[a-z0-9]+)"/g)].map(
      (m) => m[1]!
    );
    expect(ids.length).toBeGreaterThan(1);
    expect(highlightStylesVersion()).toBeGreaterThanOrEqual(before);
    const sheet = highlightStylesheet();
    for (const id of ids) expect(sheet).toContain(`.${id}{color:#`);
    expect(sheet).toContain('--shiki-d:#');
    expect(sheet).not.toContain('font-weight');
  });

  it('keeps inline colors for markdown code, without font variants', async () => {
    const [line] = (await highlightLines(['const a = 1;'], 'typescript'))!;
    expect(line).toContain('style="color:#');
    expect(line).not.toContain('font-weight');
  });

  it('folds whitespace and same-style neighbours into one span', async () => {
    const [line] = (await highlightLines(
      ['  return  total;'],
      'typescript',
      'classed'
    ))!;
    expect(line).toMatch(/^<span class="tok t[a-z0-9]+">\s+return\s+<\/span>/);
  });
});
