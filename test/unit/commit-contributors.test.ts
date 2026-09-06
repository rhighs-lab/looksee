import { describe, expect, it } from 'vitest';
import { contributorsOf } from '@/server/routes/repo.js';

describe('contributorsOf', () => {
  it('reads co-authors out of the trailers', () => {
    const out = contributorsOf(
      'Roberto Montalti',
      'roberto@example.com',
      'body text\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\nCo-authored-by: Ada <ada@example.com>\n'
    );
    expect(out.map((c) => [c.name, c.role])).toEqual([
      ['Roberto Montalti', 'author'],
      ['Claude Opus 5', 'co-author'],
      ['Ada', 'co-author'],
    ]);
  });

  it('drops a co-author who is already the author', () => {
    const out = contributorsOf(
      'Ada',
      'ada@example.com',
      'Co-Authored-By: Ada <ADA@example.com>'
    );
    expect(out).toHaveLength(1);
  });

  it('derives a github login from a noreply address', () => {
    const out = contributorsOf('Ada', '123+ada@users.noreply.github.com', '');
    expect(out[0]!.login).toBe('ada');
  });

  it('leaves an ordinary address unresolved', () => {
    expect(contributorsOf('Ada', 'ada@example.com', '')[0]!.login).toBeNull();
  });
});
