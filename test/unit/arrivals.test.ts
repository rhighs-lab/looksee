import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  addedContents,
  markIndex,
  newArrivals,
  nextArrivalSeq,
  QUIET_GAP_MS,
  takeMark,
} from '@/client/lib/arrivals.js';
import type { DiffLine, FileDiff } from '@/shared/protocol.js';

const line = (type: DiffLine['type'], content: string): DiffLine => ({
  type,
  oldNumber: null,
  newNumber: null,
  content,
});

const diffOf = (...lines: DiffLine[]): FileDiff => ({
  path: 'a.ts',
  oldPath: null,
  kind: 'modified',
  binary: false,
  language: null,
  additions: lines.filter((l) => l.type === 'add').length,
  deletions: 0,
  hunks: [
    {
      header: '',
      sectionHeading: '',
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      lines,
    },
  ],
  newLineCount: lines.length,
  rev: 'WORKTREE',
  oldRev: 'HEAD',
  digest: 'd',
  truncated: false,
});

const added = (...contents: string[]): FileDiff =>
  diffOf(...contents.map((c) => line('add', c)));

describe('addedContents', () => {
  it('collects added lines only, in file order', () => {
    const d = diffOf(
      line('context', 'ctx'),
      line('add', 'one'),
      line('del', 'gone'),
      line('add', 'two')
    );
    assert.deepEqual(addedContents(d), ['one', 'two']);
  });

  it('returns nothing for an absent diff', () => {
    assert.deepEqual(addedContents(undefined), []);
  });
});

describe('newArrivals', () => {
  it('reports a line appended to an existing set', () => {
    assert.deepEqual(newArrivals(added('a', 'b'), added('a', 'b', 'c')), ['c']);
  });

  it('reports only the inserted line when lines below it shift number', () => {
    // the renumbering trap: b and c keep their content, only their line
    // numbers moved, so they must not be reported
    assert.deepEqual(newArrivals(added('b', 'c'), added('a', 'b', 'c')), ['a']);
  });

  it('reports nothing when the diff is unchanged', () => {
    assert.deepEqual(newArrivals(added('a', 'b'), added('a', 'b')), []);
  });

  it('reports nothing for the first diff of a path', () => {
    assert.deepEqual(newArrivals(undefined, added('a', 'b')), []);
  });

  it('reports one of two identical lines when one already existed', () => {
    assert.deepEqual(newArrivals(added('same'), added('same', 'same')), [
      'same',
    ]);
  });

  it('reports nothing when a duplicate is removed', () => {
    assert.deepEqual(
      newArrivals(added('same', 'same', 'same'), added('same', 'same')),
      []
    );
  });

  it('reports the new content when a line is edited', () => {
    assert.deepEqual(newArrivals(added('a', 'old'), added('a', 'new')), [
      'new',
    ]);
  });

  it('reports nothing when an added line is removed', () => {
    assert.deepEqual(newArrivals(added('a', 'b'), added('a')), []);
  });

  it('ignores context and deleted lines on both sides', () => {
    const prev = diffOf(line('context', 'x'), line('add', 'a'));
    const next = diffOf(
      line('del', 'x'),
      line('add', 'a'),
      line('context', 'y')
    );
    assert.deepEqual(newArrivals(prev, next), []);
  });
});

describe('nextArrivalSeq', () => {
  it('keeps the sequence for a refresh inside the quiet gap', () => {
    assert.equal(nextArrivalSeq(3, 1000, 1000 + QUIET_GAP_MS - 1), 3);
  });

  it('opens a new sequence after the quiet gap', () => {
    assert.equal(nextArrivalSeq(3, 1000, 1000 + QUIET_GAP_MS + 1), 4);
  });

  it('opens a new sequence when nothing has arrived yet', () => {
    assert.equal(nextArrivalSeq(0, null, 5000), 1);
  });
});

describe('markIndex / takeMark', () => {
  it('marks each stored copy exactly once', () => {
    const idx = markIndex([
      { content: 'same', seq: 2 },
      { content: 'same', seq: 2 },
    ]);
    assert.equal(takeMark(idx, 'same'), 2);
    assert.equal(takeMark(idx, 'same'), 2);
    assert.equal(takeMark(idx, 'same'), undefined);
  });

  it('returns undefined for content that never arrived', () => {
    const idx = markIndex([{ content: 'a', seq: 1 }]);
    assert.equal(takeMark(idx, 'b'), undefined);
  });

  it('hands out the oldest sequence first for repeated content', () => {
    const idx = markIndex([
      { content: 'x', seq: 1 },
      { content: 'x', seq: 4 },
    ]);
    assert.equal(takeMark(idx, 'x'), 1);
    assert.equal(takeMark(idx, 'x'), 4);
  });
});
