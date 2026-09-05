import { inferLanguage } from '@/server/git/diff-parser.js';
import { stripSuggestions } from '@/server/review/suggestion.js';
import type { DecoratedComment } from '@/shared/protocol.js';

const lineLabel = (c: DecoratedComment) =>
  c.startLine === c.endLine
    ? `Line ${c.startLine}`
    : `Lines ${c.startLine}–${c.endLine}`;
const idMarker = (c: DecoratedComment) => `<!-- looksee:id ${c.id} -->`;

const ATTACHMENT_URL = /(^|[(\s"'])\/attachments\/([a-f0-9]+\.\w+)/g;
const localizeAttachments = (body: string) =>
  body.replace(ATTACHMENT_URL, '$1.looksee/attachments/$2');

function suggestionNote(c: DecoratedComment): string {
  if (c.applied) return 'Already applied.';
  if (c.applicable === false)
    return 'Outdated: the lines changed since this was written; adapt the intent.';
  return 'Suggested change (apply verbatim when the snapshot matches; adapt otherwise).';
}

const blockquote = (body: string) =>
  body
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

function bySortedFile(
  comments: DecoratedComment[]
): Array<[string, DecoratedComment[]]> {
  const groups = new Map<string, DecoratedComment[]>();
  for (const c of comments) {
    const list = groups.get(c.filePath) ?? [];
    list.push(c);
    groups.set(c.filePath, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, list]) => [
      file,
      list.sort((a, b) => a.startLine - b.startLine),
    ]);
}

export interface ExportMeta {
  comparison?: string | null;
  verdict?: string | null;
  summary?: string | null;
}

const KIND_ORDER: Record<string, number> = {
  suggestion: 0,
  question: 1,
  comment: 2,
};

function tally(comments: DecoratedComment[]): string {
  const n = (k: string) => comments.filter((c) => c.kind === k).length;
  const parts = Object.keys(KIND_ORDER)
    .map((k) => [k, n(k)] as const)
    .filter(([, count]) => count > 0)
    .map(([k, count]) => `${count} ${k}${count === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function howTo(comments: DecoratedComment[]): string[] {
  const first = comments[0];
  const id = first ? first.id : '<id>';
  return [
    '## Working through this review',
    '',
    'Every comment below carries its id in an HTML marker. Use the looksee',
    'CLI from the repository root to answer them:',
    '',
    '```sh',
    '# every open thread, with what each one expects',
    'looksee comments --pretty',
    '',
    '# answer a thread, then close it once the change is in',
    `looksee reply ${id} "done, see the new guard"`,
    `looksee resolve ${id}`,
    '```',
    '',
    'A `suggestion` block is a literal replacement for the lines above it.',
    'Apply it verbatim when the snapshot still matches, otherwise keep the',
    'intent and adapt. A `question` wants a reply, not a code change.',
    '',
    'Reply to every thread, then resolve the ones you addressed. Leave a',
    'thread open if you disagree, and say why in the reply.',
    '',
  ];
}

export function buildMarkdown(
  repoRoot: string,
  branch: string | null,
  comments: DecoratedComment[],
  meta: ExportMeta = {}
): string {
  const files = bySortedFile(comments);
  const out: string[] = [];
  out.push(`# Review${branch ? ` — ${branch}` : ''}`, '');
  out.push(`- Repository: \`${repoRoot}\``);
  if (meta.comparison) out.push(`- Comparison: ${meta.comparison}`);
  if (meta.verdict) out.push(`- Verdict: ${meta.verdict}`);
  out.push(
    `- Comments: ${comments.length} across ${files.length} ${
      files.length === 1 ? 'file' : 'files'
    }${tally(comments) ? ` (${tally(comments)})` : ''}`,
    `- Exported: ${new Date().toISOString()}`,
    ''
  );
  if (meta.summary) out.push('## Summary', '', meta.summary, '');
  out.push(...howTo(comments));

  out.push('## Contents', '');
  for (const [file, list] of files) out.push(`- \`${file}\` — ${list.length}`);
  out.push('');

  for (const [file, list] of files) {
    out.push(`## ${file}`, '');
    const lang = inferLanguage(file) ?? '';
    for (const c of list) {
      if (c.side === 'file') {
        out.push(`### Whole file · ${c.kind}`, '', idMarker(c), '');
        out.push(`Author: ${c.author}  ·  \`looksee reply ${c.id}\``, '');
        if (c.kind === 'question')
          out.push(
            'Question for the agent: reply and resolve, do not edit code.',
            ''
          );
        out.push(blockquote(localizeAttachments(c.body)), '');
        continue;
      }
      out.push(
        `### ${lineLabel(c)}${c.side === 'old' ? ' (old side)' : ''} · ${c.kind}`,
        '',
        idMarker(c),
        ''
      );
      out.push(`Author: ${c.author}  ·  \`looksee reply ${c.id}\``, '');
      const code = c.lineSnapshot.join('\n');
      if (code)
        out.push(
          `The lines this is about, as they read when the comment was written:`,
          '',
          `\`\`\`${lang}`,
          code,
          '```',
          ''
        );
      if (c.kind === 'question')
        out.push(
          'Question for the agent: reply and resolve, do not edit code.',
          ''
        );
      if (c.kind === 'suggestion' && c.suggestion) {
        const prose = stripSuggestions(localizeAttachments(c.body));
        if (prose) out.push(blockquote(prose), '');
        out.push(
          suggestionNote(c),
          '',
          '```suggestion',
          ...c.suggestion.lines,
          '```',
          ''
        );
      } else out.push(blockquote(localizeAttachments(c.body)), '');
    }
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

export function buildJson(comments: DecoratedComment[]): string {
  return JSON.stringify(
    bySortedFile(comments).flatMap(([file, list]) =>
      list.map((c) => ({
        id: c.id,
        author: c.author,
        file,
        side: c.side,
        lines: c.side === 'file' ? null : [c.startLine, c.endLine],
        code: c.lineSnapshot.join('\n'),
        comment: localizeAttachments(c.body),
        kind: c.kind,
        suggestion: c.suggestion,
        applicable: c.applicable,
        applied: Boolean(c.applied),
      }))
    ),
    null,
    2
  );
}
