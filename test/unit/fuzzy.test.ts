import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { fuzzyFilter, fuzzyScore, segments } from '@/client/lib/fuzzy.js';

describe('fuzzyScore', () => {
  it('rejects text missing a query character', () => {
    assert.equal(fuzzyScore('zx', 'src/index.ts'), null);
  });

  it('matches subsequences out of order positions', () => {
    assert.ok(fuzzyScore('sit', 'src/index.ts'));
  });

  it('scores consecutive basename hits above scattered ones', () => {
    const tight = fuzzyScore('review', 'src/cli/cmd/review.ts');
    const loose = fuzzyScore('review', 'src/server/routes/repo-view-wire.ts');
    assert.ok(tight && loose);
    assert.ok(tight.score > loose.score);
  });
});

describe('fuzzyFilter', () => {
  const files = [
    'src/cli/cmd/review.ts',
    'src/client/pages/review-page.tsx',
    'README.md',
  ].map((path) => ({ path }));

  it('returns the head of the list when the query is empty', () => {
    const out = fuzzyFilter('', files, (f) => f.path, 2);
    assert.deepEqual(
      out.map((m) => m.item.path),
      [files[0]!.path, files[1]!.path]
    );
  });

  it('ranks the closest path first', () => {
    const out = fuzzyFilter('review.ts', files, (f) => f.path, 10);
    assert.equal(out[0]?.item.path, 'src/cli/cmd/review.ts');
  });

  it('drops non-matching entries', () => {
    const out = fuzzyFilter('readme', files, (f) => f.path, 10);
    assert.deepEqual(
      out.map((m) => m.item.path),
      ['README.md']
    );
  });
});

describe('segments', () => {
  it('splits text on hit boundaries', () => {
    assert.deepEqual(segments('abc', [1]), [
      { text: 'a', hit: false },
      { text: 'b', hit: true },
      { text: 'c', hit: false },
    ]);
  });

  it('returns one plain segment without hits', () => {
    assert.deepEqual(segments('abc', []), [{ text: 'abc', hit: false }]);
  });
});
