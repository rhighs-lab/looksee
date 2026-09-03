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
  if (c.handoff === 'agent')
    return 'Queued for agent: apply this change on their behalf.';
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

export function buildMarkdown(
  repoRoot: string,
  branch: string | null,
  comments: DecoratedComment[]
): string {
  const out: string[] = [];
  out.push(
    `# Review feedback${branch ? ` — ${branch}` : ''}`,
    `Repo: ${repoRoot}`,
    '',
    'Please address each review comment below; make the requested change for each.',
    ''
  );
  for (const [file, list] of bySortedFile(comments)) {
    out.push(`## ${file}`, '');
    const lang = inferLanguage(file) ?? '';
    for (const c of list) {
      if (c.side === 'file') {
        out.push('### File comment', idMarker(c));
        if (c.kind === 'question')
          out.push(
            'Question for the agent: reply and resolve, do not edit code.'
          );
        out.push(blockquote(localizeAttachments(c.body)), '');
        continue;
      }
      out.push(
        `### ${lineLabel(c)}${c.side === 'old' ? ' (old side)' : ''}`,
        idMarker(c)
      );
      const code = c.lineSnapshot.join('\n');
      if (code) out.push(`\`\`\`${lang}`, code, '```');
      if (c.kind === 'question')
        out.push(
          'Question for the agent: reply and resolve, do not edit code.'
        );
      if (c.kind === 'suggestion' && c.suggestion) {
        const prose = stripSuggestions(localizeAttachments(c.body));
        if (prose) out.push(blockquote(prose));
        out.push(
          suggestionNote(c),
          '```suggestion',
          ...c.suggestion.lines,
          '```'
        );
      } else out.push(blockquote(localizeAttachments(c.body)));
      out.push('');
    }
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

export function buildJson(comments: DecoratedComment[]): string {
  return JSON.stringify(
    bySortedFile(comments).flatMap(([file, list]) =>
      list.map((c) => ({
        id: c.id,
        file,
        side: c.side,
        lines: c.side === 'file' ? null : [c.startLine, c.endLine],
        code: c.lineSnapshot.join('\n'),
        comment: localizeAttachments(c.body),
        kind: c.kind,
        suggestion: c.suggestion,
        applicable: c.applicable,
        handoff: c.handoff,
        applied: Boolean(c.applied),
      }))
    ),
    null,
    2
  );
}
