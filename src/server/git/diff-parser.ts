import crypto from 'node:crypto';
import type {
  ChangeKind,
  DiffLine,
  FileDiff,
  Hunk,
} from '@/shared/protocol.js';

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  json5: 'json5',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  dockerfile: 'docker',
  proto: 'proto',
  tf: 'terraform',
};

export function inferLanguage(p: string | null): string | null {
  if (!p) return null;
  const base = (p.split('/').pop() ?? '').toLowerCase();
  if (base === 'dockerfile') return 'docker';
  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : '';
  return EXT_LANG[ext] ?? null;
}

export type ParsedFile = Omit<
  FileDiff,
  'rev' | 'oldRev' | 'newLineCount' | 'truncated'
>;

function stripPrefix(p: string): string | null {
  if (p === '/dev/null') return null;
  return p.replace(/^[abciw]\//, '');
}

function parseHunkHeader(line: string): Omit<Hunk, 'lines'> | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
  if (!m) return null;
  return {
    oldStart: parseInt(m[1]!, 10),
    oldLines: m[2] == null ? 1 : parseInt(m[2], 10),
    newStart: parseInt(m[3]!, 10),
    newLines: m[4] == null ? 1 : parseInt(m[4], 10),
    sectionHeading: (m[5] ?? '').replace(/^\s/, ''),
    header: line,
  };
}

const isFileStart = (l: string) => l.startsWith('diff ');

export function parsePatch(patch: string): ParsedFile[] {
  const lines = patch.split('\n');
  const files: ParsedFile[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = lines[i]!;
    if (!start.startsWith('diff --git')) {
      i++;
      continue;
    }
    const sectionStart = i;
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let kind: ChangeKind = 'modified';
    let binary = false;
    const dg = /^diff --git a\/(.*) b\/(.*)$/.exec(start);
    if (dg) {
      oldPath = dg[1]!;
      newPath = dg[2]!;
    }
    i++;
    while (
      i < lines.length &&
      !lines[i]!.startsWith('@@') &&
      !isFileStart(lines[i]!)
    ) {
      const l = lines[i]!;
      if (l.startsWith('new file mode')) kind = 'added';
      else if (l.startsWith('deleted file mode')) kind = 'deleted';
      else if (l.startsWith('rename from ')) {
        kind = 'renamed';
        oldPath = l.slice('rename from '.length);
      } else if (l.startsWith('rename to ')) {
        kind = 'renamed';
        newPath = l.slice('rename to '.length);
      } else if (l.startsWith('copy from ')) {
        kind = 'copied';
        oldPath = l.slice('copy from '.length);
      } else if (l.startsWith('copy to ')) {
        kind = 'copied';
        newPath = l.slice('copy to '.length);
      } else if (
        l.startsWith('Binary files') ||
        l.startsWith('GIT binary patch')
      )
        binary = true;
      else if (l.startsWith('--- ')) {
        const p = stripPrefix(l.slice(4).trim());
        if (p !== null) oldPath = p;
        else if (kind === 'modified') kind = 'added';
      } else if (l.startsWith('+++ ')) {
        const p = stripPrefix(l.slice(4).trim());
        if (p !== null) newPath = p;
        else if (kind === 'modified') kind = 'deleted';
      }
      i++;
    }

    const hunks: Hunk[] = [];
    let cur: Hunk | null = null;
    let oldNo = 0;
    let newNo = 0;
    let additions = 0;
    let deletions = 0;
    while (i < lines.length && !isFileStart(lines[i]!)) {
      const l = lines[i]!;
      if (l.startsWith('@@')) {
        const h = parseHunkHeader(l);
        if (h) {
          cur = { ...h, lines: [] };
          hunks.push(cur);
          oldNo = h.oldStart;
          newNo = h.newStart;
        }
        i++;
        continue;
      }
      if (!cur || l.startsWith('\\')) {
        i++;
        continue;
      }
      const marker = l[0];
      const content = l.slice(1);
      let dl: DiffLine | null = null;
      if (marker === '+') {
        dl = { type: 'add', oldNumber: null, newNumber: newNo++, content };
        additions++;
      } else if (marker === '-') {
        dl = { type: 'del', oldNumber: oldNo++, newNumber: null, content };
        deletions++;
      } else if (marker === ' ') {
        dl = {
          type: 'context',
          oldNumber: oldNo++,
          newNumber: newNo++,
          content,
        };
      }
      if (dl) cur.lines.push(dl);
      i++;
    }

    const raw = lines.slice(sectionStart, i).join('\n');
    const finalNew = newPath ?? oldPath ?? '';
    const finalOld = oldPath ?? newPath ?? '';
    const path = kind === 'deleted' ? finalOld : finalNew;
    files.push({
      path,
      oldPath: finalOld !== path ? finalOld : kind === 'deleted' ? null : null,
      kind,
      binary,
      language: inferLanguage(path),
      additions,
      deletions,
      hunks,
      digest: crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16),
    });
  }
  return files;
}
