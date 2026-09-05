import { type FlagSpec, HELP_FLAG, type Parsed } from '@/cli/args.js';
import { runAgent } from '@/cli/cmd/agent.js';
import { runComment } from '@/cli/cmd/comment.js';
import { runComments } from '@/cli/cmd/comments.js';
import { runDone } from '@/cli/cmd/done.js';
import { runInit } from '@/cli/cmd/init.js';
import { runListen } from '@/cli/cmd/listen.js';
import { runReply } from '@/cli/cmd/reply.js';
import { runResolve } from '@/cli/cmd/resolve.js';
import { runReview } from '@/cli/cmd/review.js';
import {
  runReviewComment,
  runReviewDiscard,
  runReviewShow,
  runReviewStart,
  runReviewSubmit,
} from '@/cli/cmd/review-sub.js';
import { runServe } from '@/cli/cmd/serve.js';
import { runPin, runScope, runSessionEnd } from '@/cli/cmd/session.js';
import { runStatus } from '@/cli/cmd/status.js';
import { runStop } from '@/cli/cmd/stop.js';

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  env: NodeJS.ProcessEnv;
  stdin: () => Promise<string>;
  signal?: AbortSignal;
}

export interface RunCtx extends Parsed {
  io: Io;
}

export interface CommandSpec {
  name: string;
  summary: string;
  args: string;
  flags: FlagSpec[];
  output: string;
  example: string;
  notes?: string;
  run: (ctx: RunCtx) => Promise<number | undefined>;
}

const specs: CommandSpec[] = [];

export const register = (spec: CommandSpec): void => {
  const idx = specs.findIndex((s) => s.name === spec.name);
  if (idx === -1) specs.push(spec);
  else specs[idx] = spec;
};

export const find = (cmd: string[]): CommandSpec | undefined =>
  specs.find((s) => s.name === cmd.join(' '));

export const all = (): CommandSpec[] => [...specs];

const AS: FlagSpec = {
  name: 'as',
  takesValue: true,
  help: 'Actor name (default: LOOKSEE_ACTOR, then "agent")',
};

const PRETTY: FlagSpec = {
  name: 'pretty',
  takesValue: false,
  help: 'Print a readable table instead of JSON',
};

const ANCHOR = '<file>:<line>[-<line>] <body>';

const todo = (name: string) => async (): Promise<number> => {
  throw new Error(`${name}: not implemented`);
};

const placeholder = (
  spec: Omit<CommandSpec, 'run'>,
  run: CommandSpec['run'] = todo(spec.name)
): CommandSpec => ({ ...spec, run });

const COMMANDS: CommandSpec[] = [
  placeholder(
    {
      name: 'review',
      example: 'looksee review .',
      summary: 'Start the server for a repo and open the browser',
      args: '[path]',
      flags: [
        {
          name: 'base',
          takesValue: true,
          help: 'Base ref for the Branch scope only (default: detected)',
        },
        {
          name: 'title',
          takesValue: true,
          help: 'Name this review in the browser tab (default: repo folder)',
        },
        {
          name: 'scope',
          takesValue: true,
          help: 'Comparison to open on: session | working | branch',
        },
        { name: 'no-open', takesValue: false, help: 'Do not open a browser' },
        PRETTY,
      ],
      output: '{ url }',
      notes:
        'Subcommand names win over paths: use ./start for a dir named start. custom is set from the browser pickers, not --scope',
    },
    runReview
  ),
  placeholder(
    {
      name: 'review start',
      example: 'looksee review start --as reviewer',
      summary: 'Open a pending review for the actor',
      args: '',
      flags: [AS],
      output:
        'The review: { id, author, branch, state, verdict, body, createdAt, submittedAt }',
    },
    runReviewStart
  ),
  placeholder(
    {
      name: 'review comment',
      example:
        'looksee review comment src/a.ts:3-5 "Guard the null case" --as reviewer',
      summary: 'Add a draft comment to the pending review',
      args: ANCHOR,
      flags: [AS],
      output: 'The draft comment with reviewId set',
    },
    runReviewComment
  ),
  placeholder(
    {
      name: 'review submit',
      example:
        'looksee review submit --verdict request_changes "Two fixes" --as reviewer',
      summary: 'Submit the pending review with a verdict',
      args: '[body]',
      flags: [
        {
          name: 'verdict',
          takesValue: true,
          help: 'comment | approve | request_changes',
        },
        AS,
      ],
      output:
        '{ review, comments }: the submitted review and its decorated comments',
    },
    runReviewSubmit
  ),
  placeholder(
    {
      name: 'review discard',
      example: 'looksee review discard --as reviewer',
      summary: 'Delete the pending review and its drafts',
      args: '',
      flags: [AS],
      output: '{ ok: true }',
    },
    runReviewDiscard
  ),
  placeholder(
    {
      name: 'review show',
      example: 'looksee review show --as reviewer',
      summary: 'Print the pending review and its drafts',
      args: '',
      flags: [AS, PRETTY],
      output: '{ review, comments }: the pending review and its drafts',
    },
    runReviewShow
  ),
  placeholder(
    {
      name: 'listen',
      example: 'looksee listen --not-me --pending',
      summary: 'Stream review events as JSON lines until killed',
      args: '',
      flags: [
        AS,
        { name: 'not-me', takesValue: false, help: 'Drop own events' },
        {
          name: 'pending',
          takesValue: false,
          help: 'Replay unanswered items on connect, marked replay: true',
        },
        { name: 'quiet', takesValue: false, help: 'Skip the guide in hello' },
      ],
      output:
        'One JSON event per line: { type: "hello", actor, guide } first, then review.submitted { review, comments, expects }, comment.created { comment }, comment.replied { comment }, thread.resolved { id, actor }, thread.reopened { id, actor }, done.requested { actor, body, at }; every comment carries expects',
      notes:
        'Exits 1 with one stderr line when the server stays unreachable for ten seconds',
    },
    runListen
  ),
  placeholder(
    {
      name: 'comments',
      example: 'looksee comments --status open --pretty',
      summary: 'List threads with their replies and an expects hint',
      args: '',
      flags: [
        { name: 'file', takesValue: true, help: 'Only this file path' },
        { name: 'author', takesValue: true, help: 'Only this author' },
        {
          name: 'status',
          takesValue: true,
          help: 'open | resolved (default: open)',
        },
        AS,
        PRETTY,
      ],
      output:
        'An array of threads: each root comment plus expects and a replies array',
    },
    runComments
  ),
  placeholder(
    {
      name: 'reply',
      example: 'looksee reply c1 "Applied in 3f2a1c"',
      summary: 'Reply to a thread; body from the argument or stdin',
      args: '<id> [body]',
      flags: [AS],
      output:
        'The reply comment: { id, parentId, author, body, bodyHtml, ... }',
    },
    runReply
  ),
  placeholder(
    {
      name: 'resolve',
      example: 'looksee resolve c1',
      summary: 'Mark a thread resolved',
      args: '<id>',
      flags: [AS],
      output: 'The root comment with status resolved',
    },
    runResolve
  ),
  placeholder(
    {
      name: 'comment',
      example: 'looksee comment src/a.ts:12 "Renamed to cfg"',
      summary: 'Post a single comment outside a review',
      args: ANCHOR,
      flags: [AS],
      output:
        'The created comment: { id, filePath, side, startLine, endLine, lineSnapshot, body, bodyHtml, kind, suggestion, ... }',
    },
    runComment
  ),
  placeholder(
    {
      name: 'done',
      example: 'looksee done "Addressed all three threads"',
      summary: 'Record that the actor addressed the current round',
      args: '[body]',
      flags: [AS],
      output: '{ actor, body, at }',
    },
    runDone
  ),
  placeholder(
    {
      name: 'pin',
      example: 'looksee pin',
      summary: 'Re-pin the session to the current workspace',
      args: '',
      flags: [],
      output: '{ openedAt, approvedAt, label }: short shas and the comparison',
      notes: 'Clears the approval pin; the Session scope restarts from now',
    },
    runPin
  ),
  placeholder(
    {
      name: 'session end',
      example: 'looksee session end',
      summary: 'End the review session and drop its pins',
      args: '',
      flags: [],
      output: '{ ended: boolean }',
      notes: 'The next server start opens a fresh session',
    },
    runSessionEnd
  ),
  placeholder(
    {
      name: 'scope',
      example: 'looksee scope working',
      summary: 'Set or print the default scope for the UI',
      args: '[session|working|branch]',
      flags: [PRETTY],
      output:
        'The comparison: { preset, baseline, endpoint, label, note } where baseline and endpoint are { kind, oid, short, label }',
      notes: 'custom is set from the browser pickers, not from the CLI',
    },
    runScope
  ),
  placeholder(
    {
      name: 'status',
      example: 'looksee status',
      summary: 'Report the server and session for this repo',
      args: '',
      flags: [PRETTY],
      output:
        '{ running, url, pid, pendingReviews, openThreads, scope, openedAt, approvedAt, drift }: pins as short shas or null',
    },
    runStatus
  ),
  placeholder(
    {
      name: 'stop',
      example: 'looksee stop',
      summary: 'Shut down the server for this repo',
      args: '',
      flags: [],
      output: '{ stopped: boolean }',
    },
    runStop
  ),
  placeholder(
    {
      name: 'init',
      example: 'looksee init',
      summary: 'Add the looksee review rule to AGENTS.md',
      args: '',
      flags: [],
      output:
        '{ file, added }: added is false when the block was already there',
      notes: 'Writes AGENTS.md only, creating it when the repo has none',
    },
    runInit
  ),
  placeholder(
    {
      name: 'agent',
      example: 'looksee agent',
      summary: 'Print the agent guide',
      args: '',
      flags: [PRETTY],
      output: 'Plain text',
    },
    runAgent(all)
  ),
  placeholder(
    {
      name: 'serve',
      example: 'looksee serve --repo .',
      summary: 'Run the server in the foreground',
      args: '',
      flags: [
        { name: 'repo', takesValue: true, help: 'Repo path (default: cwd)' },
        {
          name: 'port',
          takesValue: true,
          help: 'Port (default: free from 4711)',
        },
        {
          name: 'base',
          takesValue: true,
          help: 'Base ref for the Branch scope only (default: detected)',
        },
        {
          name: 'title',
          takesValue: true,
          help: 'Name this review in the browser tab (default: repo folder)',
        },
      ],
      output: 'Log lines',
    },
    runServe
  ),
];

for (const c of COMMANDS) register(c);

const flagLine = (f: FlagSpec): string => {
  const alias = f.alias ? `-${f.alias}, ` : '';
  const val = f.takesValue ? ' <value>' : '';
  return `${alias}--${f.name}${val}`;
};

const cols = (rows: [string, string][]): string => {
  const w = Math.max(...rows.map(([l]) => l.length));
  return rows.map(([l, r]) => `  ${l.padEnd(w)}  ${r}`).join('\n');
};

export const helpFor = (spec: CommandSpec): string => {
  const flags = [...spec.flags, HELP_FLAG];
  const usage = `looksee ${spec.name}${spec.args ? ` ${spec.args}` : ''}`;
  return [
    spec.summary,
    '',
    'Usage:',
    `  ${usage}${flags.length ? ' [flags]' : ''}`,
    '',
    'Flags:',
    cols(flags.map((f) => [flagLine(f), f.help])),
    '',
    'Output:',
    `  ${spec.output}`,
    ...(spec.notes ? ['', 'Notes:', `  ${spec.notes}`] : []),
    '',
  ].join('\n');
};

export const rootHelp = (): string =>
  [
    'looksee',
    '',
    'Usage:',
    '  looksee <command> [args] [flags]',
    '',
    'Commands:',
    cols(specs.map((s) => [s.name, s.summary])),
    '',
    'Flags:',
    cols([
      ['-h, --help', 'Print help for a command and exit'],
      ['-v, --version', 'Print the installed version and exit'],
    ]),
    '',
  ].join('\n');
