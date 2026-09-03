import { EXPECTS } from '@/cli/expects.js';

export { EXPECTS } from '@/cli/expects.js';

export const EVENTS = [
  ['review.submitted', 'a review with verdict, body and comments'],
  ['comment.created', 'a single comment outside a review'],
  ['comment.replied', 'a reply on a thread'],
  ['thread.resolved', 'a thread was resolved'],
  ['thread.reopened', 'a thread was reopened'],
  ['done.requested', 'an actor finished a round'],
] as const;

export type EventType = (typeof EVENTS)[number][0];

export const RESPONSES = [
  ['looksee reply <id> "..."', 'answer a thread'],
  ['looksee resolve <id>', 'close a thread you addressed'],
  ['looksee done "..."', 'ask for re-review after a round'],
] as const;

export const preamble = (): string =>
  [
    'looksee events, one JSON object per line.',
    `Events: ${EVENTS.map(([t]) => t).join(', ')}.`,
    'Each comment carries filePath, side, startLine, endLine, lineSnapshot,',
    'body, bodyHtml, suggestion and an expects hint.',
    `expects is one of: ${EXPECTS.map((e) => `"${e}"`).join(', ')}.`,
    `Respond with ${RESPONSES.map(([c]) => c).join(', ')}.`,
  ].join('\n');
