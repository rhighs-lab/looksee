import posix from 'node:path/posix';
import { marked } from 'marked';
import { inferLanguage } from '@/server/git/diff-parser.js';
import { escapeHtml } from '@/server/render/escape.js';
import { highlightLines } from '@/server/render/highlighter.js';
import {
  parseSuggestions,
  renderSuggestionBlock,
} from '@/server/review/suggestion.js';
import type { Comment, CommentKind } from '@/shared/protocol.js';

marked.setOptions({ breaks: true });

const MENTION = /(^|[^\w@])@agent(?![\w-])/g;
const ENTITY = /&#(x[0-9a-f]+|\d+);?|&colon;/gi;
const SCHEME = /^([a-z][a-z0-9+.-]*):/;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

export function safeHref(href: unknown): boolean {
  const h = String(href ?? '')
    .replace(ENTITY, (_m, n: string | undefined) =>
      n === undefined
        ? ':'
        : String.fromCodePoint(
            /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n)
          )
    )
    .replace(/[\s\u0000-\u001f]/g, '')
    .toLowerCase();
  const m = SCHEME.exec(h);
  return !m || SAFE_SCHEMES.has(m[1]!);
}

function commentRenderer(): InstanceType<typeof marked.Renderer> {
  const r = new marked.Renderer();
  const link = r.link.bind(r);
  const image = r.image.bind(r);
  r.html = (html: string) => escapeHtml(html);
  r.link = (href: string, title: string | null | undefined, text: string) =>
    safeHref(href) ? link(href, title, text) : text;
  r.image = (href: string, title: string | null, text: string) =>
    safeHref(href) ? image(href, title, text) : escapeHtml(text);
  r.text = (text: string) =>
    text.replace(
      MENTION,
      '$1<span class="mention mention-agent">@agent</span>'
    );
  return r;
}

export function renderMarkdown(body: string): string {
  return marked.parse(body || '', {
    renderer: commentRenderer(),
    async: false,
  }) as string;
}

export const isLineRoot = (c: Pick<Comment, 'side' | 'parentId'>): boolean =>
  c.side !== 'file' && !c.parentId;
export const isSuggestionRoot = (
  c: Pick<Comment, 'side' | 'parentId'>
): boolean => isLineRoot(c) && c.side === 'new';

const stripCode = (body: string) =>
  body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
const hasMention = (body: string) =>
  new RegExp(MENTION.source).test(stripCode(body));

export function kindOf(
  c: Pick<Comment, 'side' | 'parentId' | 'body'>,
  sugs?: { lines: string[] }[]
): CommentKind {
  if (isSuggestionRoot(c) && (sugs ?? parseSuggestions(c.body)).length)
    return 'suggestion';
  if (hasMention(c.body)) return 'question';
  return 'comment';
}

export interface RenderOpts {
  snapshot?: string[];
  applicable?: boolean | null;
  applied?: boolean;
}

export function renderCommentHtml(
  c: Pick<Comment, 'side' | 'parentId' | 'body'> & { id?: string },
  opts: RenderOpts = {}
): string {
  if (!isSuggestionRoot(c)) return renderMarkdown(c.body);
  const renderer = commentRenderer();
  const base = renderer.code.bind(renderer);
  let seen = false;
  renderer.code = (
    code: string,
    lang: string | undefined,
    escaped: boolean
  ) => {
    if ((lang ?? '').trim() !== 'suggestion' || seen)
      return base(code, lang, escaped);
    seen = true;
    const added = code === '' ? [] : code.split(/\r?\n/);
    return renderSuggestionBlock({
      removed: opts.snapshot ?? [],
      added,
      applicable: opts.applicable ?? null,
      applied: opts.applied ?? false,
      id: c.id ?? null,
    });
  };
  return marked.parse(c.body || '', { renderer, async: false }) as string;
}

export const isMarkdownPath = (path: string): boolean =>
  /\.(?:md|markdown|mdown|mkd)$/i.test(path);

const SLUG = /[^\w\- ]+/g;
const slug = (text: string): string =>
  text.toLowerCase().replace(SLUG, '').trim().replace(/\s+/g, '-');

/**
 * A whole markdown file, not a comment: headings get anchors, fenced code is
 * highlighted server-side by the same shiki pass the diff uses, and a mermaid
 * fence is left for the browser to draw.
 */
/** A repo-relative target of `docPath`, or null when it points outside. */
const resolveRel = (docPath: string, href: string): string | null => {
  if (!href || href.startsWith('#') || href.startsWith('/')) return null;
  if (SCHEME.test(href)) return null;
  const dir = posix.dirname(docPath);
  const target = href.split(/[?#]/)[0] ?? '';
  if (!target) return null;
  const p = posix.normalize(posix.join(dir === '.' ? '' : dir, target));
  return p.startsWith('..') || p.startsWith('/') ? null : p;
};

export async function renderDoc(body: string, docPath = ''): Promise<string> {
  const code: Array<{ token: string; text: string; lang: string | null }> = [];
  const r = new marked.Renderer();
  const heading = r.heading.bind(r);
  r.heading = (text: string, level: number, raw: string) => {
    const id = slug(raw);
    return heading(text, level, raw).replace(
      /^<h(\d)/,
      `<h$1 id="${escapeHtml(id)}"`
    );
  };
  r.link = (href: string, title: string | null | undefined, text: string) => {
    if (!safeHref(href)) return text;
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    const ext = /^[a-z]+:/i.test(href)
      ? ' target="_blank" rel="noreferrer noopener"'
      : '';
    const rel = resolveRel(docPath, href);
    const to = rel
      ? `/file/${rel.split('/').map(encodeURIComponent).join('/')}`
      : href;
    return `<a href="${escapeHtml(to)}"${t}${ext}>${text}</a>`;
  };
  r.code = (text: string, lang?: string) => {
    const info = (lang ?? '').trim().split(/\s+/)[0] ?? '';
    if (info.toLowerCase() === 'mermaid')
      return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
    const token = `\u0000code${code.length}\u0000`;
    code.push({ token, text, lang: info || null });
    return `<p>${token}</p>`;
  };

  let html = marked.parse(body || '', {
    renderer: r,
    async: false,
    gfm: true,
    breaks: false,
  }) as string;

  html = html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]*)(")/gi,
    (m, head: string, src: string, tail: string) => {
      const rel = resolveRel(docPath, src);
      if (rel) return `${head}/api/raw?path=${encodeURIComponent(rel)}${tail}`;
      return safeHref(src) ? m : `${head}${tail}`;
    }
  );

  for (const block of code) {
    const lang = block.lang
      ? (inferLanguage(`x.${block.lang}`) ?? block.lang)
      : null;
    const lines = block.text.replace(/\n$/, '').split('\n');
    const painted = await highlightLines(lines, lang).catch(() => null);
    const inner = (painted ?? lines.map(escapeHtml))
      .map((l) => `<span class="doc-line">${l}</span>`)
      .join('\n');
    html = html.replace(
      `<p>${block.token}</p>`,
      `<pre class="doc-code"><code>${inner}</code></pre>`
    );
  }
  return html;
}
