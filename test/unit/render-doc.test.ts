import { describe, expect, it } from 'vitest';
import { renderDoc } from '@/server/review/markdown.js';

describe('renderDoc', () => {
  it('points a relative image at the raw blob beside the document', async () => {
    const html = await renderDoc('![shot](assets/a.png)', 'docs/readme.md');
    expect(html).toContain('src="/api/raw?path=docs%2Fassets%2Fa.png"');
  });

  it('sends a relative link to the file view', async () => {
    const html = await renderDoc('[up](../LICENSE)', 'docs/readme.md');
    expect(html).toContain('href="/file/LICENSE"');
  });

  it('leaves absolute and anchor targets alone', async () => {
    const html = await renderDoc(
      '![x](https://h/i.png)\n\n[a](#top)',
      'readme.md'
    );
    expect(html).toContain('src="https://h/i.png"');
    expect(html).toContain('href="#top"');
  });

  it('resolves a raw html image the same way', async () => {
    const html = await renderDoc(
      '<img src="assets/a.png" width="10">',
      'docs/readme.md'
    );
    expect(html).toContain('src="/api/raw?path=docs%2Fassets%2Fa.png"');
    expect(html).toContain('width="10"');
  });

  it('drops an unsafe image scheme', async () => {
    const html = await renderDoc('<img src="javascript:alert(1)">', 'r.md');
    expect(html).not.toContain('javascript:');
  });

  it('refuses a target that climbs out of the repo', async () => {
    const html = await renderDoc('![x](../../etc/passwd)', 'readme.md');
    expect(html).toContain('src="../../etc/passwd"');
    expect(html).not.toContain('/api/raw');
  });
});
