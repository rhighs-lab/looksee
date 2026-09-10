import {
  type BundledLanguage,
  createHighlighter,
  type Highlighter,
  type ThemedToken,
} from 'shiki';
import { escapeHtml } from '@/server/render/escape.js';
import { darkened } from '@/server/render/themes/darkened.js';
import type { Range, WordLine } from '@/server/render/word-diff.js';
import type { Hunk } from '@/shared/protocol.js';

// Every theme the client can switch to is tokenized in one pass: shiki writes the
// default theme's color inline and the rest as custom properties, so switching themes
// is a CSS change rather than a re-render.
const THEMES = {
  light: 'github-light',
  d: 'github-dark',
  sl: 'solarized-light',
  sd: 'solarized-dark',
  al: 'one-light',
  ad: 'one-dark-pro',
  dkd: 'darkened',
  drc: 'dracula',
  nrd: 'nord',
  tkl: 'tokyo-night',
  ctl: 'catppuccin-latte',
  ctd: 'catppuccin-mocha',
  efl: 'everforest-light',
  efd: 'everforest-dark',
} as const;

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [
      ...Object.values(THEMES).filter((t) => t !== 'darkened'),
      darkened,
    ],
    langs: [],
  });
  return highlighterPromise;
}

async function ensureLang(
  hl: Highlighter,
  lang: string | null
): Promise<boolean> {
  if (!lang) return false;
  if (loadedLangs.has(lang)) return true;
  try {
    await hl.loadLanguage(lang as BundledLanguage);
    loadedLangs.add(lang);
    return true;
  } catch {
    return false;
  }
}

interface Tok {
  content: string;
  htmlStyle?: Record<string, string> | string | undefined;
}

const cache = new Map<string, Tok[][]>();
const CACHE_MAX = 800;

const COLOR_VAR = /^--shiki-[a-z]+$/;

function tokenStyle(tok: Tok): string {
  const st = tok.htmlStyle;
  if (!st || typeof st === 'string') return typeof st === 'string' ? st : '';
  const color = st['color'];
  if (!color) return '';
  const parts = [`color:${color}`];
  for (const [k, v] of Object.entries(st))
    if (COLOR_VAR.test(k)) parts.push(`${k}:${v}`);
  return parts.join(';');
}

// Every distinct style tuple becomes one shared class, so a token costs a few
// bytes instead of one inline declaration per theme.
const styleIds = new Map<string, string>();
const styleRules = new Map<string, string>();

const hashStyle = (css: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < css.length; i++) {
    h ^= css.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `t${h.toString(36)}`;
};

function styleClass(css: string): string {
  const hit = styleIds.get(css);
  if (hit) return hit;
  let id = hashStyle(css);
  while (styleRules.has(id) && styleRules.get(id) !== css) id = `${id}x`;
  styleIds.set(css, id);
  styleRules.set(id, css);
  return id;
}

export const highlightStylesVersion = (): number => styleRules.size;

export const highlightStylesheet = (): string => {
  let out = '';
  for (const [id, css] of styleRules) out += `.${id}{${css}}\n`;
  return out;
};

export type TokenMode = 'inline' | 'classed';

interface StyledRun {
  content: string;
  style: string;
}

const BLANK = /^\s*$/;

// Whitespace takes no color of its own and neighbours often share one, so
// runs of equal style collapse into a single span.
function mergeRuns(tokens: Tok[]): StyledRun[] {
  const runs: StyledRun[] = [];
  let lead = '';
  for (const tok of tokens) {
    const prev = runs[runs.length - 1];
    if (BLANK.test(tok.content)) {
      if (prev) prev.content += tok.content;
      else lead += tok.content;
      continue;
    }
    const style = tokenStyle(tok);
    if (prev && prev.style === style) prev.content += tok.content;
    else runs.push({ content: lead + tok.content, style });
    lead = '';
  }
  if (lead) runs.push({ content: lead, style: '' });
  return runs;
}

function tokenToHtml(
  tok: StyledRun,
  base: number,
  ranges: Range[] | undefined,
  mode: TokenMode
): string {
  const style = tok.style;
  const content = tok.content;
  const classed = style && mode === 'classed' ? ` ${styleClass(style)}` : '';
  const styleAttr = style && mode === 'inline' ? ` style="${style}"` : '';
  if (!ranges || ranges.length === 0)
    return style
      ? `<span class="tok${classed}"${styleAttr}>${escapeHtml(content)}</span>`
      : escapeHtml(content);
  const inRange = (abs: number) => ranges.some(([s, e]) => abs >= s && abs < e);
  let out = '';
  let i = 0;
  while (i < content.length) {
    const changed = inRange(base + i);
    let j = i + 1;
    while (j < content.length && inRange(base + j) === changed) j++;
    out += `<span class="${changed ? 'tok wd' : 'tok'}${classed}"${styleAttr}>${escapeHtml(content.slice(i, j))}</span>`;
    i = j;
  }
  return out;
}

function assembleLine(
  lineTokens: Tok[] | undefined,
  ranges: Range[] | undefined,
  mode: TokenMode
): string {
  if (!lineTokens) return '';
  let html = '';
  let pos = 0;
  for (const run of mergeRuns(lineTokens)) {
    html += tokenToHtml(run, pos, ranges, mode);
    pos += run.content.length;
  }
  return html;
}

const plainTokenLines = (text: string): Tok[][] =>
  text.split('\n').map((l) => (l === '' ? [] : [{ content: l }]));

function tokensForText(hl: Highlighter, text: string, lang: string): Tok[][] {
  const key = `${lang} ${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let perLine: Tok[][];
  try {
    perLine = hl.codeToTokens(text, {
      lang: lang as BundledLanguage,
      themes: THEMES,
    }).tokens as ThemedToken[][];
  } catch {
    perLine = plainTokenLines(text);
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, perLine);
  return perLine;
}

export async function highlightLines(
  lines: string[],
  lang: string | null,
  mode: TokenMode = 'inline'
): Promise<string[] | null> {
  if (!lang) return null;
  const hl = await getHighlighter();
  if (!(await ensureLang(hl, lang))) return null;
  return tokensForText(hl, lines.join('\n'), lang).map((tl) =>
    assembleLine(tl, undefined, mode)
  );
}

export async function highlightHunks(
  hunks: Hunk[],
  language: string | null
): Promise<void> {
  let hl: Highlighter | null = null;
  let lang: string | null = null;
  if (language) {
    hl = await getHighlighter();
    if (await ensureLang(hl, language)) lang = language;
  }
  for (const hunk of hunks) {
    const lines = hunk.lines as WordLine[];
    const newText = lines
      .filter((l) => l.type !== 'del')
      .map((l) => l.content)
      .join('\n');
    const oldText = lines
      .filter((l) => l.type !== 'add')
      .map((l) => l.content)
      .join('\n');
    const newTokens =
      lang && hl ? tokensForText(hl, newText, lang) : plainTokenLines(newText);
    const oldTokens =
      lang && hl ? tokensForText(hl, oldText, lang) : plainTokenLines(oldText);
    let ni = 0;
    let oi = 0;
    for (const line of lines) {
      const tokens = line.type === 'del' ? oldTokens[oi] : newTokens[ni];
      if (lang || line.wordRanges?.length)
        line.html = assembleLine(tokens, line.wordRanges, 'classed');
      if (line.type === 'context') {
        ni++;
        oi++;
      } else if (line.type === 'add') ni++;
      else oi++;
      delete line.wordRanges;
    }
  }
}
