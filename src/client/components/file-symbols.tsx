import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Close } from '@/client/components/icons.js';
import { scopeChain } from '@/client/lib/scope-chain.js';
import { Button } from '@/client/ui/index.js';
import type { CodeSymbol, FileSymbols } from '@/shared/protocol.js';
import '@/client/styles/symbols.css';

const ROW_HEIGHT = 26;
const UNAVAILABLE: FileSymbols = { status: 'unavailable', symbols: [] };

/** The blob keeps a line's indentation; the pin drops it and shows the rest. */
const withoutIndent = (html: string): string => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const rest = (n.nodeValue ?? '').replace(/^\s+/, '');
    n.nodeValue = rest;
    if (rest) break;
  }
  return tpl.innerHTML;
};

export function FileSymbolsView({
  data = UNAVAILABLE,
  children,
  onJump,
  host,
  path,
  open,
  onToggle,
  lineHtml,
}: {
  data: FileSymbols | undefined;
  lineHtml?: string[] | null | undefined;
  host: HTMLElement | null;
  path: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  onJump: (line: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{
    chain: CodeSymbol[];
    shifts: number[];
  }>({ chain: [], shifts: [] });
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const scrollArea = element.closest<HTMLElement>('.file-body');
    if (!scrollArea) return;
    let frame = 0;
    let dirty = true;
    let rows: { line: number; top: number; bottom: number }[] = [];
    const update = () => {
      frame = 0;
      const origin = scrollArea.getBoundingClientRect().top;
      if (dirty) {
        rows = Array.from(
          element.querySelectorAll<HTMLElement>('.blob-num[data-line-number]')
        ).map((cell) => {
          const bounds = cell.closest('tr')!.getBoundingClientRect();
          return {
            line: Number(cell.dataset['lineNumber']),
            top: bounds.top - origin + scrollArea.scrollTop,
            bottom: bounds.bottom - origin + scrollArea.scrollTop,
          };
        });
        dirty = false;
      }
      const edge = scrollArea.scrollTop;
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (rows[mid]!.bottom <= edge) lo = mid + 1;
        else hi = mid;
      }
      const candidate = rows[lo];
      const row =
        candidate && candidate.top > edge && lo > 0 ? rows[lo - 1] : candidate;
      const chain =
        row && row.top <= edge ? scopeChain(data.symbols, row.line) : [];
      // Each scope leaves independently; an inner method must not move its class.
      const shifts = chain.map((symbol, index) => {
        const end = rows[symbol.endLine - 1];
        return end
          ? Math.min(0, end.bottom - edge - (index + 1) * ROW_HEIGHT)
          : 0;
      });
      setPosition((old) =>
        old.shifts.join() === shifts.join() &&
        old.chain.map((s) => s.id).join() === chain.map((s) => s.id).join()
          ? old
          : { chain, shifts }
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(() => {
      dirty = true;
      schedule();
    });
    resize.observe(element);
    const blob = element.querySelector('.blob-view');
    if (blob) resize.observe(blob);
    resize.observe(scrollArea);
    scrollArea.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scrollArea.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [data]);
  const active = position.chain.at(-1)?.id;
  const depths = new Map<string, number>();
  for (const symbol of data.symbols)
    depths.set(
      symbol.id,
      symbol.parentId ? (depths.get(symbol.parentId) ?? 0) + 1 : 0
    );
  const shown = data.symbols.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );
  const message =
    data.status === 'unsupported'
      ? 'Symbols are not supported for this file.'
      : data.status === 'too-large'
        ? 'This file is too large to list symbols.'
        : data.status === 'unavailable'
          ? 'Symbols could not be read.'
          : 'No symbols found.';
  return (
    <div ref={root} className="file-code-layout">
      <div className="file-code-column">
        <nav className="scope-sticky" aria-label="Current code scope">
          <div className="scope-stack">
            {position.chain.map((symbol, index) => (
              <button
                type="button"
                key={symbol.id}
                style={{
                  transform: `translateY(${position.shifts[index]}px)`,
                  zIndex: 3 - index,
                }}
                onClick={() => onJump(symbol.startLine)}
                title={`Go to ${symbol.name}, line ${symbol.startLine}`}
              >
                <span className="scope-number">{symbol.startLine}</span>
                <ScopeSignature symbol={symbol} lineHtml={lineHtml} />
              </button>
            ))}
          </div>
        </nav>
        {children}
      </div>
      {host &&
        createPortal(
          <aside className="file-symbols" aria-label="File symbols">
            <div className="symbols-heading">
              {open && (
                <span>
                  Symbols{' '}
                  <span className="symbols-count">{data.symbols.length}</span>
                </span>
              )}
              <Button
                small
                icon
                aria-expanded={open}
                aria-label={open ? 'Hide symbols' : 'Show symbols'}
                onClick={onToggle}
              >
                <Close width={14} height={14} />
              </Button>
            </div>
            {open && (
              <>
                <input
                  className="symbols-search"
                  aria-label="Filter symbols"
                  placeholder="Filter symbols…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="symbols-filename" title={path}>
                  {path.split('/').pop()}
                </div>
                <nav className="symbols-list" aria-label="Symbols">
                  {shown.map((symbol) => (
                    <button
                      type="button"
                      key={symbol.id}
                      className={`tree-row symbol-row${active === symbol.id ? ' is-active' : ''}`}
                      aria-current={
                        active === symbol.id ? 'location' : undefined
                      }
                      style={{
                        paddingLeft:
                          8 + Math.min(depths.get(symbol.id) ?? 0, 6) * 12,
                      }}
                      title={`${symbol.kind} ${symbol.name}, line ${symbol.startLine}`}
                      onClick={() => onJump(symbol.startLine)}
                    >
                      <span
                        className={`symbol-kind symbol-${symbol.kind}`}
                        aria-hidden="true"
                      >
                        {symbol.kind === 'function' || symbol.kind === 'method'
                          ? 'ƒ'
                          : symbol.kind.charAt(0).toUpperCase()}
                      </span>
                      <span className="tree-name">{symbol.name}</span>
                      <span className="symbol-line">{symbol.startLine}</span>
                    </button>
                  ))}
                  {!shown.length && (
                    <p className="symbols-empty">
                      {data.symbols.length ? 'No matching symbols.' : message}
                    </p>
                  )}
                </nav>
              </>
            )}
          </aside>,
          host
        )}
    </div>
  );
}

function ScopeSignature({
  symbol,
  lineHtml,
}: {
  symbol: CodeSymbol;
  lineHtml?: string[] | null | undefined;
}) {
  const html = lineHtml?.[symbol.startLine - 1];
  if (!html) return <code>{symbol.signature}</code>;
  return (
    <code
      className="scope-code"
      dangerouslySetInnerHTML={{ __html: withoutIndent(html) }}
    />
  );
}
