import { describe, expect, it } from 'vitest';
import { all } from '@/cli/commands.js';
import { EXPECTS } from '@/cli/expects.js';
import { fullGuide, preamble } from '@/cli/guide.js';
import { type Io, run } from '@/cli/main.js';

const R16 = [
  'review.submitted',
  'comment.created',
  'comment.replied',
  'thread.resolved',
  'thread.reopened',
  'done.requested',
  'hello',
];

describe('fullGuide', () => {
  const text = fullGuide(all());

  it('mentions every registered command', () => {
    for (const c of all()) expect(text).toContain(`looksee ${c.name}`);
  });

  it('mentions every R16 event type', () => {
    for (const t of R16) expect(text).toContain(`"type":"${t}"`);
  });

  it('includes every expects value', () => {
    for (const e of EXPECTS) expect(text).toContain(`"${e}"`);
  });

  it('renders a non-empty example for every command', () => {
    for (const c of all()) {
      expect(c.example, c.name).toMatch(/^looksee /);
      expect(text).toContain(c.example);
    }
  });

  it('explains sessions, pins and scopes', () => {
    expect(text).toMatch(/pin/);
    expect(text).toMatch(/approve/);
    for (const c of [
      'looksee pin',
      'looksee scope working',
      'looksee session end',
    ])
      expect(text).toContain(c);
    expect(preamble()).toMatch(/pin/);
  });

  it('stays plain text under 132 lines', () => {
    const lines = text.split('\n');
    expect(lines.length).toBeLessThan(132);
    expect(text).not.toMatch(/^#/m);
  });
});

describe('looksee agent', () => {
  it('prints the guide to stdout only and exits 0', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: (s: string) => void out.push(s),
      err: (s: string) => void err.push(s),
      env: {},
      stdin: async () => '',
    };
    expect(await run(['agent', '--pretty'], io)).toBe(0);
    expect(out.join('')).toBe(fullGuide(all()));
    expect(err).toEqual([]);
  });
});
