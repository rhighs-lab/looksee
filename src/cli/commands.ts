import { type FlagSpec, HELP_FLAG, type Parsed } from '@/cli/args.js';
import { runReview } from '@/cli/cmd/review.js';
import { runServe } from '@/cli/cmd/serve.js';
import { runStatus } from '@/cli/cmd/status.js';
import { runStop } from '@/cli/cmd/stop.js';

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  env: NodeJS.ProcessEnv;
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
      summary: 'Start the server for a repo and open the browser',
      args: '[path]',
      flags: [
        { name: 'base', takesValue: true, help: 'Base ref to diff against' },
        { name: 'no-open', takesValue: false, help: 'Do not open a browser' },
        PRETTY,
      ],
      output: '{ url }',
      notes:
        'Subcommand names win over paths: use ./start for a dir named start',
    },
    runReview
  ),
  placeholder({
    name: 'review start',
    summary: 'Open a pending review for the actor',
    args: '',
    flags: [AS],
    output: 'The review object',
  }),
  placeholder({
    name: 'review comment',
    summary: 'Add a draft comment to the pending review',
    args: ANCHOR,
    flags: [AS],
    output: 'The created comment',
  }),
  placeholder({
    name: 'review submit',
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
    output: 'The submitted review with its comments',
  }),
  placeholder({
    name: 'review discard',
    summary: 'Delete the pending review and its drafts',
    args: '',
    flags: [AS],
    output: '{ ok: true }',
  }),
  placeholder({
    name: 'review show',
    summary: 'Print the pending review and its drafts',
    args: '',
    flags: [AS, PRETTY],
    output: 'The review with a comments array',
  }),
  placeholder({
    name: 'listen',
    summary: 'Stream review events as JSON lines until killed',
    args: '',
    flags: [
      AS,
      { name: 'not-me', takesValue: false, help: 'Drop own events' },
      {
        name: 'pending',
        takesValue: false,
        help: 'Replay unanswered items on connect',
      },
      { name: 'quiet', takesValue: false, help: 'Skip the guide in hello' },
    ],
    output: 'One JSON event per line',
  }),
  placeholder({
    name: 'comments',
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
    output: 'An array of threads',
  }),
  placeholder({
    name: 'reply',
    summary: 'Reply to a thread; body from the argument or stdin',
    args: '<id> [body]',
    flags: [AS],
    output: 'The reply comment',
  }),
  placeholder({
    name: 'resolve',
    summary: 'Mark a thread resolved',
    args: '<id>',
    flags: [AS],
    output: 'The updated root comment',
  }),
  placeholder({
    name: 'comment',
    summary: 'Post a single comment outside a review',
    args: ANCHOR,
    flags: [AS],
    output: 'The created comment',
  }),
  placeholder({
    name: 'done',
    summary: 'Record that the actor addressed the current round',
    args: '[body]',
    flags: [AS],
    output: '{ actor, body, at }',
  }),
  placeholder(
    {
      name: 'status',
      summary: 'Report the server for this repo',
      args: '',
      flags: [PRETTY],
      output: '{ running, url, pid, pendingReviews, openThreads }',
    },
    runStatus
  ),
  placeholder(
    {
      name: 'stop',
      summary: 'Shut down the server for this repo',
      args: '',
      flags: [],
      output: '{ stopped: boolean }',
    },
    runStop
  ),
  placeholder({
    name: 'agent',
    summary: 'Print the agent guide',
    args: '',
    flags: [],
    output: 'Markdown text',
  }),
  placeholder(
    {
      name: 'serve',
      summary: 'Run the server in the foreground',
      args: '',
      flags: [
        { name: 'repo', takesValue: true, help: 'Repo path (default: cwd)' },
        {
          name: 'port',
          takesValue: true,
          help: 'Port (default: free from 4711)',
        },
        { name: 'base', takesValue: true, help: 'Base ref to diff against' },
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
    'looksee - local GitHub-style review of uncommitted work',
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
