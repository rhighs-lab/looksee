import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RunCtx } from '@/cli/commands.js';
import { repoRootOf } from '@/cli/daemon.js';
import { format } from '@/cli/output.js';

const FILE = 'AGENTS.md';
export const MARKER = '<!-- looksee -->';

export const AGENT_FILES: { agent: string; home: string; file: string }[] = [
  { agent: 'claude-code', home: '.claude', file: 'CLAUDE.md' },
  { agent: 'codex', home: '.codex', file: 'AGENTS.md' },
  { agent: 'gemini-cli', home: '.gemini', file: 'GEMINI.md' },
  { agent: 'opencode', home: path.join('.config', 'opencode'), file: FILE },
];

const BLOCK = [
  MARKER,
  '## Reviewing changes with looksee',
  '',
  'After finishing a set of code changes, offer the user a review before',
  'pushing: "want to look these over in looksee first?". Skip the offer when',
  'they asked you to commit or push immediately.',
  '',
  'On yes, run `looksee review . --scope <preset>` — `branch` if you made',
  'commits, `working` if you only changed the working tree, `session` on a',
  're-review round. Then work the comment loop; `looksee agent` prints the',
  'full guide.',
].join('\n');

const exists = (p: string): Promise<boolean> =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false);

async function addBlock(file: string): Promise<boolean> {
  const cur = await fs.readFile(file, 'utf8').catch(() => null);
  if (cur?.split('\n').some((l) => l.trim() === MARKER)) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    cur ? `${cur.trimEnd()}\n\n${BLOCK}\n` : `${BLOCK}\n`
  );
  return true;
}

const globalTargets = async (): Promise<{ agent: string; file: string }[]> => {
  const home = os.homedir();
  const found = [];
  for (const a of AGENT_FILES)
    if (await exists(path.join(home, a.home)))
      found.push({ agent: a.agent, file: path.join(home, a.home, a.file) });
  return found;
};

export const runInit = async ({ flags, io }: RunCtx): Promise<number> => {
  if (flags['local'] === true) {
    const file = path.join(await repoRootOf(), FILE);
    io.out(
      format(
        {
          scope: 'local',
          files: [{ file: FILE, added: await addBlock(file) }],
        },
        false
      )
    );
    return 0;
  }
  const targets = await globalTargets();
  const files = [];
  for (const t of targets)
    files.push({ agent: t.agent, file: t.file, added: await addBlock(t.file) });
  io.out(format({ scope: 'global', files }, false));
  return 0;
};
