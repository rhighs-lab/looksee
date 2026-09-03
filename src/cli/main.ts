#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgv } from '@/cli/args.js';
import { all, find, helpFor, type Io, rootHelp } from '@/cli/commands.js';
import { packageRoot } from '@/server/pkg-root.js';

export type { Io } from '@/cli/commands.js';

const version = (): string =>
  (
    JSON.parse(
      readFileSync(
        path.join(packageRoot(import.meta.url), 'package.json'),
        'utf8'
      )
    ) as { version: string }
  ).version;

const defaultIo: Io = {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
  env: process.env,
};

export const run = async (argv: string[], io = defaultIo): Promise<number> => {
  try {
    const parsed = parseArgv(argv, all());
    if (!parsed.cmd.length) {
      if (parsed.flags['version']) {
        io.out(`${version()}\n`);
        return 0;
      }
      if (parsed.flags['help'] || !parsed.positionals.length) {
        io.out(rootHelp());
        return 0;
      }
      io.err(rootHelp());
      return 1;
    }
    const spec = find(parsed.cmd)!;
    if (parsed.flags['help']) {
      io.out(helpFor(spec));
      return 0;
    }
    return (await spec.run({ ...parsed, io })) ?? 0;
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
};

const isEntry = (): boolean => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isEntry()) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
