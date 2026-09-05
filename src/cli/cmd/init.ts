import fs from 'node:fs/promises';
import path from 'node:path';
import type { RunCtx } from '@/cli/commands.js';
import { repoRootOf } from '@/cli/daemon.js';
import { format } from '@/cli/output.js';

const FILE = 'AGENTS.md';
const START = '<!-- looksee:start -->';
const END = '<!-- looksee:end -->';

const BLOCK = [
  START,
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
  END,
].join('\n');

const read = async (p: string): Promise<string | null> => {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
};

export const runInit = async ({ io }: RunCtx): Promise<number> => {
  const root = await repoRootOf();
  const file = path.join(root, FILE);
  const cur = await read(file);
  const added = !(cur?.includes(START) && cur.includes(END));
  if (added)
    await fs.writeFile(
      file,
      cur ? `${cur.trimEnd()}\n\n${BLOCK}\n` : `${BLOCK}\n`
    );
  io.out(format({ file: FILE, added }, false));
  return 0;
};
