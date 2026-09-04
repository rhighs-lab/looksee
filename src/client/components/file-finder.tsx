import { useEffect, useMemo, useRef, useState } from 'react';
import { KindIcon } from '@/client/components/layer-badges.js';
import { fileHref } from '@/client/lib/anchors.js';
import { fuzzyFilter, segments } from '@/client/lib/fuzzy.js';
import type { Scope, TreeEntry } from '@/shared/protocol.js';

const LIMIT = 50;

const isTypingTarget = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable);

export function useFileFinderHotkey(open: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const palette = mod && (e.key === 'k' || e.key === 'p');
      if (!palette && !(e.key === 't' && !mod && !e.altKey)) return;
      e.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
}

export function FileFinder({
  entries,
  scope,
  onClose,
}: {
  entries: TreeEntry[];
  scope: Scope;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => fuzzyFilter(q, entries, (e) => e.path, LIMIT),
    [q, entries]
  );

  useEffect(() => inputRef.current?.focus(), []);

  const go = (path: string) => {
    location.href = fileHref(path, scope);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only mirrors Escape, which the input handles
    <div
      className="finder-overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="finder"
        role="dialog"
        aria-modal="true"
        aria-label="Go to file"
      >
        <input
          ref={inputRef}
          className="finder-input"
          type="text"
          placeholder="Go to file…"
          spellCheck={false}
          autoComplete="off"
          value={q}
          aria-label="Go to file"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return onClose();
            if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              const hit = matches[sel];
              if (hit) go(hit.item.path);
            }
          }}
        />
        {matches.length === 0 ? (
          <div className="finder-empty">No matching files</div>
        ) : (
          <div className="finder-list" role="listbox" aria-label="Files">
            {matches.map((m, i) => (
              <button
                key={m.item.path}
                type="button"
                className="finder-row"
                role="option"
                aria-selected={i === sel}
                ref={
                  i === sel
                    ? (el) => el?.scrollIntoView({ block: 'nearest' })
                    : undefined
                }
                onMouseMove={() => setSel(i)}
                onClick={() => go(m.item.path)}
              >
                <KindIcon kind={m.item.kind} />
                <span className="finder-path">
                  {segments(m.item.path, m.hits).map((seg, k) => (
                    <span
                      key={`${k}:${seg.text}`}
                      className={seg.hit ? 'finder-hit' : undefined}
                    >
                      {seg.text}
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="finder-hint">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>enter</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> dismiss
          </span>
        </div>
      </div>
    </div>
  );
}
