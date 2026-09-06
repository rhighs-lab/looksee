export interface FlagSpec {
  name: string;
  alias?: string;
  takesValue: boolean;
  help: string;
}

export interface Parsed {
  cmd: string[];
  positionals: string[];
  flags: Record<string, string | boolean>;
  repeated: Record<string, string[]>;
}

export interface Resolvable {
  name: string;
  flags: FlagSpec[];
}

export const HELP_FLAG: FlagSpec = {
  name: 'help',
  alias: 'h',
  takesValue: false,
  help: 'Print this help and exit',
};

const VERSION_FLAG: FlagSpec = {
  name: 'version',
  alias: 'v',
  takesValue: false,
  help: 'Print the installed version and exit',
};

const lookup = (
  tok: string,
  flags: FlagSpec[]
): { spec: FlagSpec; inline: string | null } | null => {
  const long = tok.startsWith('--');
  const raw = tok.slice(long ? 2 : 1);
  const eq = long ? raw.indexOf('=') : -1;
  const key = eq === -1 ? raw : raw.slice(0, eq);
  const inline = eq === -1 ? null : raw.slice(eq + 1);
  const spec = flags.find((f) => (long ? f.name === key : f.alias === key));
  return spec ? { spec, inline } : null;
};

export const parseArgv = (argv: string[], specs: Resolvable[]): Parsed => {
  const names = new Set(specs.map((s) => s.name));
  const leads = (p: string): boolean =>
    [...names].some((n) => n === p || n.startsWith(`${p} `));
  const cmd: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok.startsWith('-')) break;
    if (!leads([...cmd, tok].join(' '))) break;
    cmd.push(tok);
    i++;
  }
  while (cmd.length && !names.has(cmd.join(' '))) {
    cmd.pop();
    i--;
  }
  const own = specs.find((s) => s.name === cmd.join(' '))?.flags ?? [];
  const flags = cmd.length ? [...own, HELP_FLAG] : [HELP_FLAG, VERSION_FLAG];
  const out: Parsed = { cmd, positionals: [], flags: {}, repeated: {} };
  let rest = false;
  for (; i < argv.length; i++) {
    const tok = argv[i]!;
    if (rest || tok === '-' || !tok.startsWith('-')) {
      out.positionals.push(tok);
      continue;
    }
    if (tok === '--') {
      rest = true;
      continue;
    }
    const hit = lookup(tok, flags);
    if (!hit) throw new Error(`unknown flag ${tok}`);
    const { spec, inline } = hit;
    if (!spec.takesValue) {
      out.flags[spec.name] = true;
      continue;
    }
    const val = inline ?? argv[++i];
    if (val === undefined) throw new Error(`--${spec.name} needs a value`);
    out.flags[spec.name] = val;
    (out.repeated[spec.name] ??= []).push(val);
  }
  return out;
};
