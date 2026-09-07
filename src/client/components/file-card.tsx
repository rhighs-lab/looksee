import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  DiffTable,
  type LineSlots,
  useExpansion,
} from '@/client/components/diff/diff-table.js';
import { ExpandAllButton } from '@/client/components/diff/expand-all.js';
import { EditorLink } from '@/client/components/editor-link.js';
import { FileCommits } from '@/client/components/file-commits.js';
import { FileInfo } from '@/client/components/file-info.js';
import { ForgeLink } from '@/client/components/forge-link.js';
import { HeaderActions } from '@/client/components/header-actions.js';
import { ChevronDown, CommentIcon, Copy } from '@/client/components/icons.js';
import { ImageDiff, isImage } from '@/client/components/image-blob.js';
import { KindIcon, LayerLetters } from '@/client/components/layer-badges.js';
import { SkeletonLines } from '@/client/components/loading.js';
import { fileAnchor } from '@/client/lib/anchors.js';
import { KIND_TONE } from '@/client/lib/layers.js';
import { useReview } from '@/client/store/review.js';
import { Button, Label, LinkButton, Notice } from '@/client/ui/index.js';
import type { ChangedFile, FileDiff, Scope } from '@/shared/protocol.js';
import { KIND_LABEL, LARGE_DIFF_LINES } from '@/shared/protocol.js';

export function DiffStat({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const total = additions + deletions;
  const blocks = 5;
  let green = 0;
  let red = 0;
  if (total > 0) {
    green = Math.round((additions / total) * blocks);
    red = Math.round((deletions / total) * blocks);
    if (additions > 0 && green === 0) green = 1;
    if (deletions > 0 && red === 0) red = 1;
    while (green + red > blocks) {
      if (green >= red) green--;
      else red--;
    }
  }
  const cells: string[] = [
    ...Array<string>(green).fill('add'),
    ...Array<string>(red).fill('del'),
    ...Array<string>(blocks - green - red).fill('neutral'),
  ];
  return (
    <span className="diffstat" role="img" aria-label={`${total} changes`}>
      {cells.map((c, i) => (
        <span
          key={`${c}${i}`}
          className={`diffstat-block diffstat-block-${c}`}
        />
      ))}
    </span>
  );
}

export interface FileCardProps {
  file: ChangedFile;
  diff: FileDiff | undefined;
  pending: boolean;
  slots?: LineSlots | undefined;
  fileComments?: ReactNode;
  onFileComment?: ((path: string) => void) | undefined;
  viewHref: string;
}

export const FileCard = memo(function FileCard({
  file,
  diff,
  pending,
  slots,
  fileComments,
  onFileComment,
  viewHref,
}: FileCardProps) {
  const collapsed = useReview((s) => Boolean(s.collapsed[file.path]));
  const viewed = useReview((s) => s.viewed[file.path] !== undefined);
  const updated = useReview((s) => Boolean(s.updated[file.path]));
  const split = useReview((s) => s.view === 'split');
  const scope = useReview((s) => s.scope);
  const toggleCollapsed = useReview((s) => s.toggleCollapsed);
  const setViewed = useReview((s) => s.setViewed);
  const markSeen = useReview((s) => s.markSeen);
  const loadFull = useReview((s) => s.loadFull);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const additions = diff?.additions ?? file.additions;
  const deletions = diff?.deletions ?? file.deletions;
  const kind = diff?.kind ?? file.kind;

  useEffect(() => {
    if (!updated || !ref.current) return;
    const el = ref.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          timer = setTimeout(() => markSeen(file.path), 1500);
        else if (timer) clearTimeout(timer);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [updated, file.path, markSeen]);

  const copyPath = useCallback(() => {
    void navigator.clipboard?.writeText(file.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 800);
    });
  }, [file.path]);

  return (
    <div
      className={`file${collapsed ? ' is-collapsed' : ''}${pending ? ' is-refreshing' : ''}`}
      id={fileAnchor(file.path)}
      data-path={file.path}
      ref={ref}
    >
      <div className="file-header">
        <Button
          variant="invisible"
          icon
          small
          className="collapse-btn"
          title="Collapse or expand this diff"
          aria-label="Toggle diff"
          aria-expanded={!collapsed}
          onClick={() => toggleCollapsed(file.path)}
        >
          <ChevronDown className="chevron" />
        </Button>
        <DiffStat additions={additions} deletions={deletions} />
        <span className="file-additions">+{additions}</span>
        <span className="file-deletions">−{deletions}</span>
        <span className="file-info">
          <KindIcon kind={kind} />
          {file.oldPath && file.oldPath !== file.path && (
            <span className="file-rename ui-mono ui-muted">
              {file.oldPath} →{' '}
            </span>
          )}
          <span className="file-path ui-mono" title={file.path}>
            {file.path}
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
          {kind !== 'modified' && (
            <Label tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Label>
          )}
          {file.binary && <Label>binary</Label>}
          {file.generated && (
            <Label title="Looks generated (lockfile, build output or minified)">
              generated
            </Label>
          )}
          {updated && (
            <Label
              tone="attention"
              title="This file changed since you last looked at it"
            >
              updated
            </Label>
          )}
          <LayerLetters file={file} />
        </span>
        <HeaderActions>
          {onFileComment && (
            <Button
              variant="invisible"
              icon
              small
              title="Comment on this file"
              aria-label="Comment on this file"
              onClick={() => onFileComment(file.path)}
            >
              <CommentIcon />
            </Button>
          )}
          <FileCommits path={file.path} oldPath={file.oldPath} />
          <FileInfo path={file.path} />
          <EditorLink filePath={file.path} />
          <ForgeLink filePath={file.path} />
          {diff && !diff.binary && diff.hunks.length > 0 && (
            <FileExpandAll diff={diff} />
          )}
        </HeaderActions>
        <LinkButton href={viewHref}>View file</LinkButton>
        <label className="viewed-toggle">
          <input
            type="checkbox"
            className="viewed-checkbox"
            checked={viewed}
            onChange={(e) => setViewed(file.path, e.target.checked)}
          />{' '}
          Viewed
        </label>
      </div>
      <div className="file-body">
        <div className="file-comments">{fileComments}</div>
        <FileBody
          file={file}
          diff={diff}
          split={split}
          slots={slots ?? {}}
          scope={scope}
          loadFull={loadFull}
        />
      </div>
    </div>
  );
});

function FileBody({
  file,
  diff,
  split,
  slots,
  scope,
  loadFull,
}: {
  file: ChangedFile;
  diff: FileDiff | undefined;
  split: boolean;
  slots: LineSlots;
  scope: Scope;
  loadFull: (p: string) => Promise<void>;
}) {
  if (file.binary)
    return isImage(file.path) ? (
      <ImageDiff file={file} scope={scope} />
    ) : (
      <div className="file-notice-body">Binary file not shown.</div>
    );
  if (file.kind === 'unchanged' && !diff?.hunks.length)
    return (
      <div className="file-notice-body">
        No net change against the base branch; the staged and working-tree edits
        cancel out.
      </div>
    );
  if (!diff) return <SkeletonLines rows={6} />;
  if (diff.truncated)
    return <TruncatedNotice diff={diff} loadFull={loadFull} />;
  if (!diff.hunks.length)
    return (
      <div className="file-notice-body">
        No textual changes (mode or metadata only).
      </div>
    );
  return <ExpandableTable diff={diff} split={split} slots={slots} />;
}

function TruncatedNotice({
  diff,
  loadFull,
}: {
  diff: FileDiff;
  loadFull: (p: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="file-notice-body">
      <Notice tone="muted">
        Large diff ({diff.additions + diff.deletions} changed lines, over{' '}
        {LARGE_DIFF_LINES}) not rendered automatically.{' '}
        <Button
          small
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void loadFull(diff.path).finally(() => setBusy(false));
          }}
        >
          {busy ? 'Loading' : 'Load diff'}
        </Button>
      </Notice>
    </div>
  );
}

function ExpandableTable({
  diff,
  split,
  slots,
}: {
  diff: FileDiff;
  split: boolean;
  slots: LineSlots;
}) {
  const { expansions, expand, loading } = useExpansion(diff);
  const arrived = useReview((s) => s.arrivals[diff.path]);
  return (
    <DiffTable
      diff={diff}
      split={split}
      slots={slots}
      expansions={expansions}
      loading={loading}
      onExpand={(gap, dir) => void expand(gap, dir)}
      arrived={arrived}
    />
  );
}

function FileExpandAll({ diff }: { diff: FileDiff }) {
  const { expansions, expand, collapseAll } = useExpansion(diff);
  return (
    <ExpandAllButton
      diff={diff}
      expansions={expansions}
      expand={(gap, dir) => void expand(gap, dir)}
      collapseAll={collapseAll}
    />
  );
}
