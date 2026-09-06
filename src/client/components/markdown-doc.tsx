import { useEffect, useRef } from 'react';
import { useReview } from '@/client/store/review.js';

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;

/** Mermaid is heavy, so it only arrives when a document actually has a graph. */
const loadMermaid = (dark: boolean) => {
  mermaidReady ??= import('mermaid').then((m) => m.default);
  return mermaidReady.then((m) => {
    m.initialize({
      startOnLoad: false,
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
    });
    return m;
  });
};

export function MarkdownDoc({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const appearance = useReview((s) => s.appearance);

  // biome-ignore lint/correctness/useExhaustiveDependencies: html and appearance are the triggers, not values the body reads
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const blocks = [...root.querySelectorAll<HTMLElement>('pre.mermaid')];
    if (!blocks.length) return;
    let alive = true;
    const dark = document.documentElement.dataset['mode'] === 'dark';
    void loadMermaid(dark)
      .then(async (m) => {
        for (const [i, el] of blocks.entries()) {
          if (!alive) return;
          const src = el.dataset['src'] ?? el.textContent ?? '';
          el.dataset['src'] = src;
          try {
            const { svg } = await m.render(
              `mmd-${Date.now()}-${i}`,
              src,
              undefined
            );
            if (alive) el.innerHTML = svg;
          } catch (err) {
            el.textContent = `mermaid: ${(err as Error).message}`;
            el.classList.add('mermaid-failed');
          }
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [html, appearance]);

  return (
    <div
      className="markdown-doc"
      ref={ref}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered and sanitized by the server
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
