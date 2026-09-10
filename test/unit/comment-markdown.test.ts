import { describe, expect, it } from 'vitest';
import { renderCommentHtml, renderMarkdown } from '@/server/review/markdown.js';

describe('comment markdown', () => {
  it('highlights a fenced block with the diff highlighter', async () => {
    const html = await renderMarkdown(
      'Try this:\n\n```ts\nconst x: number = 1;\n```\n'
    );
    expect(html).toContain('<pre class="doc-code"><code>');
    expect(html).toContain('class="doc-line"');
    expect(html).toMatch(/class="tok t[0-9a-z]+"/);
    expect(html).not.toContain('style="');
    expect(html).toContain('number');
  });

  it('keeps a fence readable when the language is unknown', async () => {
    const html = await renderMarkdown('```nope\na < b\n```');
    expect(html).toContain('<span class="doc-line">a &lt; b</span>');
  });

  it('renders gfm lists, tables and inline code', async () => {
    const html = await renderMarkdown(
      '- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nsee `src/a.ts:3`'
    );
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<table>');
    expect(html).toContain('<code>src/a.ts:3</code>');
  });

  it('still renders the suggestion block and highlights the rest', async () => {
    const html = await renderCommentHtml(
      {
        side: 'new',
        parentId: null,
        body: '```suggestion\nlet y = 2;\n```\n\nbecause:\n\n```js\nconst z = 3;\n```',
      },
      { snapshot: ['let y = 1;'], applicable: true }
    );
    expect(html).toMatch(/suggestion-diff/);
    expect(html).toContain('<pre class="doc-code">');
  });
});
