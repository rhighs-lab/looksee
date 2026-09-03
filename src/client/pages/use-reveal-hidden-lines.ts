import { useEffect } from 'react';
import { api } from '@/client/api/client.js';
import { boundaries, rangeFor } from '@/client/components/diff/rows.js';
import { lineMap } from '@/client/lib/snapshot.js';
import type { Thread } from '@/client/store/comments.js';
import { useReview } from '@/client/store/review.js';
import type { DiffLine } from '@/shared/protocol.js';

const inflight = new Set<string>();

export function useRevealHiddenLines(
  threadsByFile: Map<string, Thread[]>
): void {
  const diffs = useReview((s) => s.diffs);
  const expansions = useReview((s) => s.expansions);
  useEffect(() => {
    for (const [path, threads] of threadsByFile) {
      const diff = diffs[path];
      if (!diff || diff.truncated) continue;
      const visibleNew = lineMap(diff, expansions[path], 'new');
      const visibleOld = lineMap(diff, expansions[path], 'old');
      for (const t of threads) {
        const r = t.root;
        if (r.side === 'file') continue;
        const line = r.endLine || r.startLine;
        const visible = r.side === 'old' ? visibleOld : visibleNew;
        if (visible.has(line)) continue;
        for (const b of boundaries(diff)) {
          const n = r.side === 'old' ? line - b.offset : line;
          if (n < b.start || n > b.end) continue;
          const key = `${path}:${b.key}:${n}`;
          if (inflight.has(key)) break;
          inflight.add(key);
          const { from, to } = rangeFor('mid', b.start, b.end, n);
          void api
            .context(path, diff.rev, from, to)
            .then((res) => {
              const lines: DiffLine[] = res.lines.map((content, i) => {
                const html = res.html ? res.html[i] : undefined;
                return {
                  type: 'context',
                  oldNumber: res.from + i + b.offset,
                  newNumber: res.from + i,
                  content,
                  ...(html !== undefined ? { html } : {}),
                };
              });
              const cur = useReview.getState().expansions[path] ?? {};
              useReview.getState().setExpansions(path, {
                ...cur,
                [b.key]: [...(cur[b.key] ?? []), { from: res.from, lines }],
              });
            })
            .catch(() => {})
            .finally(() => inflight.delete(key));
          break;
        }
      }
    }
  }, [threadsByFile, diffs, expansions]);
}
