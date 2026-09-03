import fs from 'node:fs/promises';
import path from 'node:path';

export interface Anchor {
  filePath: string;
  side: 'new';
  startLine: number;
  endLine: number;
  lineSnapshot: string[];
}

const SHAPE = /^(.+):(\d+)(?:-(\d+))?$/;
const USAGE = 'expected <file>:<line>[-<line>]';

export const parseAnchor = (
  s: string
): { file: string; startLine: number; endLine: number } => {
  const m = SHAPE.exec(s);
  if (!m) throw new Error(`bad anchor "${s}": ${USAGE}`);
  const startLine = Number(m[2]);
  const endLine = m[3] ? Number(m[3]) : startLine;
  if (startLine < 1 || endLine < startLine)
    throw new Error(`bad anchor "${s}": ${USAGE}`);
  return { file: m[1]!, startLine, endLine };
};

export const readAnchor = async (root: string, s: string): Promise<Anchor> => {
  const { file, startLine, endLine } = parseAnchor(s);
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error(`${file} is outside the repo`);
  const text = await fs.readFile(abs, 'utf8').catch(() => {
    throw new Error(`no such file: ${file}`);
  });
  const lines = text.replace(/\n$/, '').split('\n');
  if (endLine > lines.length)
    throw new Error(`${file} has ${lines.length} lines, not ${endLine}`);
  return {
    filePath: rel.split(path.sep).join('/'),
    side: 'new',
    startLine,
    endLine,
    lineSnapshot: lines.slice(startLine - 1, endLine),
  };
};
