import { escapeHtml } from '@/server/render/escape.js';

export const FENCE = /^```suggestion[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

export const stripSuggestions = (body: string): string =>
  body.replace(FENCE, '').trim();

export function parseSuggestions(body: string): { lines: string[] }[] {
  const out: { lines: string[] }[] = [];
  for (const m of body.matchAll(FENCE)) {
    const text = (m[1] ?? '').replace(/\r?\n$/, '');
    out.push({ lines: text === '' ? [] : text.split(/\r?\n/) });
  }
  return out;
}

const row = (cls: string, marker: string, line: string) =>
  `<tr><td class="blob-code ${cls}"><span class="blob-code-inner"><span class="marker">${marker}</span>${escapeHtml(line)}</span></td></tr>`;

type Status = 'applied' | 'queued' | 'outdated' | 'ready';

const STATUS: Record<
  Status,
  { label: string; cls: string; actions: boolean; canApply: boolean }
> = {
  applied: {
    label: 'Applied',
    cls: 'is-applied',
    actions: false,
    canApply: false,
  },
  queued: {
    label: 'Queued for agent',
    cls: 'is-queued',
    actions: false,
    canApply: false,
  },
  outdated: {
    label: 'Outdated',
    cls: 'is-outdated',
    actions: true,
    canApply: false,
  },
  ready: { label: 'Suggested change', cls: '', actions: true, canApply: true },
};

export interface SuggestionBlock {
  removed: string[];
  added: string[];
  applicable: boolean | null;
  handoff: 'agent' | null;
  applied: boolean;
  id: string | null;
}

const statusOf = ({
  applied,
  handoff,
  applicable,
}: SuggestionBlock): Status => {
  if (applied) return 'applied';
  if (handoff === 'agent') return 'queued';
  if (applicable === false) return 'outdated';
  return 'ready';
};

export function renderSuggestionBlock(b: SuggestionBlock): string {
  const st = STATUS[statusOf(b)];
  const rows =
    b.removed.map((l) => row('blob-code-deletion', '-', l)).join('') +
    b.added.map((l) => row('blob-code-addition', '+', l)).join('');
  const apply = st.canApply
    ? '<button class="suggestion-apply">Apply now</button>'
    : '<button class="suggestion-apply" disabled title="The file changed since this comment">Apply now</button>';
  const actions = st.actions
    ? `<div class="suggestion-actions">${apply}<button class="suggestion-handoff">Let agent do it</button><span class="suggestion-error" hidden></span></div>`
    : '';
  return (
    `<div class="suggestion${st.cls ? ` ${st.cls}` : ''}"${b.id ? ` data-comment-id="${escapeHtml(b.id)}"` : ''}>` +
    `<div class="suggestion-header"><span class="suggestion-label">${st.label}</span>${actions}</div>` +
    `<table class="suggestion-diff"><tbody>${rows}</tbody></table>` +
    '</div>'
  );
}
