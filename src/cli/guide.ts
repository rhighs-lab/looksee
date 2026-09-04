import type { CommandSpec } from '@/cli/commands.js';
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
    'The human reviews a session: workspace since the last pin or approve.',
  ].join('\n');

const MEANING: Record<(typeof EXPECTS)[number], string> = {
  'apply or reply': 'a suggestion: apply the proposed lines or say why not',
  answer: 'a question: reply with the answer',
  'fix and reply': 'a comment: change the code, then reply with what you did',
  'fix, reply, resolve, then run looksee done':
    'a request_changes review: handle every comment, then run looksee done',
  'read, reply if asked': 'a comment-only review: no action unless asked',
  none: 'an approval: a signal only, pushing stays with you or the human',
};

const COMMENT = {
  id: 'c1',
  parentId: null,
  author: 'user',
  filePath: 'src/a.ts',
  side: 'new',
  startLine: 3,
  endLine: 5,
  lineSnapshot: ['const x = cfg.x;'],
  body: 'Guard the null case',
  status: 'open',
  reviewId: 'r1',
  kind: 'comment',
  suggestion: null,
  expects: 'fix and reply',
};

const STUB = { id: 'c1', expects: 'fix and reply' };

const REVIEW = {
  id: 'r1',
  author: 'user',
  branch: 'main',
  state: 'submitted',
  verdict: 'request_changes',
  body: 'Two fixes before push',
};

const SAMPLES: Record<string, unknown>[] = [
  { type: 'hello', actor: 'agent', guide: '...' },
  {
    type: 'review.submitted',
    review: REVIEW,
    comments: [STUB],
    expects: 'fix, reply, resolve, then run looksee done',
  },
  { type: 'comment.created', comment: STUB },
  { type: 'comment.replied', comment: { ...STUB, parentId: 'c0' } },
  { type: 'thread.resolved', id: 'c1', actor: 'agent' },
  { type: 'thread.reopened', id: 'c1', actor: 'user' },
  { type: 'done.requested', actor: 'agent', body: 'All threads handled' },
];

const rule = (title: string, ch: string): string[] => [
  title,
  ch.repeat(title.length),
];

const json = (o: unknown): string => JSON.stringify(o);

export const fullGuide = (cmds: readonly CommandSpec[]): string =>
  [
    ...rule('looksee agent guide', '='),
    '',
    'looksee is a local, GitHub-style review of the uncommitted work in a',
    'repo. A human reviews the diff in the browser and leaves comments and',
    'reviews; agents read them as JSON events, act, and write back from the',
    'terminal. One server per repo, localhost only, started on demand.',
    '',
    ...rule('The loop', '-'),
    '1. Run looksee listen --not-me --pending in the background, keep it up.',
    '2. Read one JSON object per line; each event is a complete work item.',
    '3. Act: apply the suggestion, fix the code, or answer the question.',
    '4. Write back with looksee reply <id> "..." and looksee resolve <id>.',
    '5. After a request_changes round, run looksee done "..." for re-review.',
    'Reviewer agents use looksee review start | comment | submit instead.',
    '',
    ...rule('Recommended invocation', '-'),
    '  looksee listen --not-me --pending --as <name>',
    '--not-me drops your own events; --pending replays unanswered items on',
    'connect, marked "replay": true. --as defaults to LOOKSEE_ACTOR, then',
    '"agent"; the human in the browser is always "user".',
    '',
    ...rule('Session', '-'),
    'Each repo has a review session with two pins: openedAt, taken when',
    'the server starts, and approvedAt, moved forward when the human',
    'approves. The default Session scope shows the workspace since the',
    'latest pin, so an approve marks everything before it as seen.',
    'looksee pin re-pins to now; looksee scope working shows HEAD to',
    'workspace instead; looksee session end drops the pins. Events and',
    'the commands below are unaffected by scope.',
    '',
    ...rule('Commands', '-'),
    'Commands print JSON; add --pretty for a table where supported.',
    'Run looksee <command> --help for arguments and flags.',
    ...cmds.flatMap((c) => [`  ${c.example}`, `      ${c.summary}`]),
    '',
    ...rule('Events', '-'),
    'One JSON object per line. Comment objects are shortened here; every',
    'comment carries the fields in the Comment shape below.',
    ...SAMPLES.map(json),
    '',
    ...rule('Comment shape', '-'),
    JSON.stringify(COMMENT, null, 2),
    '',
    ...rule('expects', '-'),
    'Every comment and review.submitted event carries an expects hint:',
    ...EXPECTS.flatMap((e) => [`  "${e}"`, `      ${MEANING[e]}`]),
    '',
  ].join('\n');
