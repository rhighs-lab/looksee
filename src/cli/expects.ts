import type { CommentKind, Verdict } from '@/shared/protocol.js';

export const EXPECTS = [
  'apply or reply',
  'answer',
  'fix and reply',
  'fix, reply, resolve, then run looksee done',
  'read, reply if asked',
  'none',
] as const;

export type Expects = (typeof EXPECTS)[number];

const BY_KIND: Record<CommentKind, Expects> = {
  suggestion: 'apply or reply',
  question: 'answer',
  comment: 'fix and reply',
};

const BY_VERDICT: Record<Verdict, Expects> = {
  request_changes: 'fix, reply, resolve, then run looksee done',
  comment: 'read, reply if asked',
  approve: 'none',
};

export const expectsFor = (c: { kind: CommentKind }): Expects =>
  BY_KIND[c.kind];

export const expectsForVerdict = (v: Verdict): Expects => BY_VERDICT[v];
