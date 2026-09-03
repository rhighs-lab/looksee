import process from 'node:process';

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const cell = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v);

const table = (rows: Row[]): string => {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const grid = [keys, ...rows.map((r) => keys.map((k) => cell(r[k])))];
  const widths = keys.map((_, i) =>
    Math.max(...grid.map((line) => line[i]!.length))
  );
  return grid
    .map((line) =>
      line
        .map((c, i) => (i === line.length - 1 ? c : c.padEnd(widths[i]!)))
        .join('  ')
        .trimEnd()
    )
    .join('\n');
};

export const format = (val: unknown, pretty: boolean): string => {
  if (!pretty) return `${JSON.stringify(val, null, 2)}\n`;
  if (typeof val === 'string') return `${val}\n`;
  if (Array.isArray(val) && val.length && val.every(isRow))
    return `${table(val)}\n`;
  return `${JSON.stringify(val, null, 2)}\n`;
};

export const emit = (val: unknown, opts: { pretty?: boolean } = {}): void => {
  process.stdout.write(format(val, opts.pretty === true));
};

export const fail = (msg: string): never => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};
