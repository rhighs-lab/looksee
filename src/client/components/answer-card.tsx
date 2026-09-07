import { useCallback, useEffect, useState } from 'react';
import { api } from '@/client/api/client.js';
import { Avatar } from '@/client/components/comments/avatar.js';
import { DiffTable } from '@/client/components/diff/diff-table.js';
import { ExpandAllButton } from '@/client/components/diff/expand-all.js';
import type { Dir, GapInfo } from '@/client/components/diff/rows.js';
import { EditorLink } from '@/client/components/editor-link.js';
import { FileCommits } from '@/client/components/file-commits.js';
import { FileInfo } from '@/client/components/file-info.js';
import { ForgeLink } from '@/client/components/forge-link.js';
import { HeaderActions } from '@/client/components/header-actions.js';
import { ChevronDown, Copy } from '@/client/components/icons.js';
import { fileAnchor } from '@/client/lib/anchors.js';
import type { Expansions } from '@/client/store/review.js';
import { Button, Label, LinkButton } from '@/client/ui/index.js';
import type { AnswerHit, DiffLine, FileDiff } from '@/shared/protocol.js';

const PAD = 4;

export const hitAnchor = (hit: AnswerHit, i: number): string =>
  `${fileAnchor(hit.path)}-h${i}`;

const toLines = (
  from: number,
  lines: string[],
  html: string[] | null,
  hitRange?: { start: number; end: number }
): DiffLine[] =>
  lines.map((content, i) => {
    const n = from + i;
    const h = html ? html[i] : undefined;
    return {
      type: 'context' as const,
      oldNumber: null,
      newNumber: n,
      content,
      ...(h !== undefined ? { html: h } : {}),
      ...(hitRange && n >= hitRange.start && n <= hitRange.end
        ? { hit: true }
        : {}),
    };
  });

const toDiff = (
  path: string,
  from: number,
  lines: DiffLine[],
  eof: boolean
): FileDiff => {
  const last = from + lines.length - 1;
  return {
    path,
    oldPath: null,
    kind: 'modified',
    binary: false,
    language: null,
    additions: 0,
    deletions: 0,
    hunks: lines.length
      ? [
          {
            header: '',
            sectionHeading: '',
            oldStart: from,
            oldLines: lines.length,
            newStart: from,
            newLines: lines.length,
            lines,
          },
        ]
      : [],
    newLineCount: eof ? last : last + 1,
    rev: 'WORKTREE',
    oldRev: 'WORKTREE',
    digest: 'answer',
    truncated: false,
  };
};

/**
 * Expansion state is local, not the store's: two hits in one file would share
 * the store's per-path entry and their boundary keys both start at b0.
 */
function useLocalExpansion(diff: FileDiff | null) {
  const [expansions, setExpansions] = useState<Expansions>({});
  const [loading, setLoading] = useState<Set<string>>(() => new Set());

  const expand = useCallback(
    async (gap: GapInfo, dir: Dir) => {
      if (!diff) return;
      const span = gap.end - gap.start + 1;
      const from = dir === 'up' ? Math.max(gap.start, gap.end - 19) : gap.start;
      const to = dir === 'up' ? gap.end : Math.min(gap.end, gap.start + 19);
      if (span <= 0) return;
      const key = `${gap.boundary}:${from}`;
      setLoading((s) => new Set(s).add(key));
      try {
        const res = await api.context(diff.path, diff.rev, from, to);
        setExpansions((cur) => ({
          ...cur,
          [gap.boundary]: [
            ...(cur[gap.boundary] ?? []),
            { from: res.from, lines: toLines(res.from, res.lines, res.html) },
          ],
        }));
      } catch {
        /* leave the expander so the user can retry */
      } finally {
        setLoading((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [diff]
  );

  const collapseAll = useCallback(() => setExpansions({}), []);

  return { expansions, expand, collapseAll, loading };
}

export function AnswerCard({
  hit,
  index,
  author,
}: {
  hit: AnswerHit;
  index: number;
  author: string;
}) {
  const [open, setOpen] = useState(true);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { expansions, expand, collapseAll, loading } = useLocalExpansion(diff);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const from = Math.max(1, hit.startLine - PAD);
    api
      .context(hit.path, 'WORKTREE', from, hit.endLine + PAD)
      .then((res) => {
        if (!alive) return;
        const lines = toLines(res.from, res.lines, res.html, {
          start: hit.startLine,
          end: hit.endLine,
        });
        setDiff(toDiff(hit.path, res.from, lines, res.eof));
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [hit.path, hit.startLine, hit.endLine]);

  const copyPath = () => {
    void navigator.clipboard?.writeText(hit.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div
      className={`file answer-card${open ? '' : ' is-collapsed'}`}
      id={hitAnchor(hit, index)}
    >
      <div className="file-header">
        <Button
          variant="invisible"
          icon
          small
          className="collapse-btn"
          title="Collapse or expand this snippet"
          aria-label="Toggle snippet"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown className="chevron" />
        </Button>
        <span className="file-info">
          <span className="file-path ui-mono" title={hit.path}>
            {hit.path}
          </span>
          <Button
            variant="invisible"
            icon
            small
            className={copied ? 'copied' : ''}
            title="Copy path"
            aria-label="Copy path"
            onClick={copyPath}
          >
            <Copy />
          </Button>
          {hit.symbol && (
            <span className="answer-symbol ui-mono">{hit.symbol}</span>
          )}
          {hit.role && <Label>{hit.role}</Label>}
          <span className="answer-line ui-mono ui-muted">
            :{hit.startLine}
            {hit.endLine !== hit.startLine ? `-${hit.endLine}` : ''}
          </span>
        </span>
        <HeaderActions>
          <FileCommits path={hit.path} oldPath={null} />
          <FileInfo path={hit.path} />
          <EditorLink filePath={hit.path} line={hit.startLine} />
          <ForgeLink filePath={hit.path} line={hit.startLine} />
          {diff && (
            <ExpandAllButton
              diff={diff}
              expansions={expansions}
              expand={(gap, dir) => void expand(gap, dir)}
              collapseAll={collapseAll}
            />
          )}
        </HeaderActions>
        <LinkButton href={`/file/${hit.path}#L${hit.startLine}`}>
          View file
        </LinkButton>
      </div>
      {open && (
        <div className="file-body">
          {hit.why && (
            <p className="answer-why">
              <Avatar author={author} />
              <span>{hit.why}</span>
            </p>
          )}
          {error && <p className="answer-why ui-attention">{error}</p>}
          {diff && (
            <DiffTable
              diff={diff}
              split={false}
              slots={{}}
              expansions={expansions}
              loading={loading}
              onExpand={expand}
            />
          )}
        </div>
      )}
    </div>
  );
}
