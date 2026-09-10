import { useShallow } from 'zustand/react/shallow';
import {
  CommentsPanel,
  CommentsPanelToggle,
  CommentsVisibilityToggle,
} from '@/client/components/comments/comments-panel.js';
import { ReviewBanner } from '@/client/components/comments/review-banner.js';
import { ReviewBar } from '@/client/components/comments/review-bar.js';
import { useCommentSlots } from '@/client/components/comments/use-comment-slots.js';
import { ReviewPage } from '@/client/pages/review-page.js';
import { canApply, useComments } from '@/client/store/comments.js';
import { Button } from '@/client/ui/index.js';

export function ReviewWithComments() {
  const { enabled, slotsFor, fileCommentsFor, onFileComment } =
    useCommentSlots();
  const commentCounts = useComments(
    useShallow((s) => {
      const counts: Record<string, number> = {};
      for (const t of Object.values(s.threads)) {
        if (t.root.status === 'resolved') continue;
        counts[t.root.filePath] = (counts[t.root.filePath] ?? 0) + 1;
      }
      return counts;
    })
  );

  return (
    <>
      <ReviewPage
        slotsFor={enabled ? (f) => slotsFor(f.path) : undefined}
        fileCommentsFor={enabled ? (f) => fileCommentsFor(f.path) : undefined}
        onFileComment={enabled ? onFileComment : undefined}
        commentCounts={enabled ? commentCounts : undefined}
        above={enabled ? <ReviewBanner /> : null}
        aside={enabled ? <CommentsPanel /> : null}
        headerRight={
          enabled ? (
            <>
              <CommentsPanelToggle />
              <CommentsVisibilityToggle />
              <ReviewActions />
              <ReviewBar />
            </>
          ) : null
        }
      />
    </>
  );
}

function ReviewActions() {
  const { count, applyable } = useComments(
    useShallow((s) => {
      const roots = Object.values(s.threads)
        .map((t) => t.root)
        .filter((r) => r.status !== 'resolved');
      return { count: roots.length, applyable: roots.filter(canApply).length };
    })
  );
  const applyAll = useComments((s) => s.applyAll);
  const exportAll = useComments((s) => s.exportAll);
  const clearAll = useComments((s) => s.clearAll);
  if (!count) return null;
  return (
    <>
      {applyable > 0 && (
        <Button small onClick={() => void applyAll()}>
          Apply {applyable} suggestion{applyable === 1 ? '' : 's'}
        </Button>
      )}
      <Button
        small
        variant="primary"
        onClick={() => void exportAll()}
        title={`Write ${count} comment${count === 1 ? '' : 's'} to .looksee as markdown`}
      >
        Export review as .md
      </Button>
      <Button small onClick={() => void clearAll()}>
        Clear
      </Button>
    </>
  );
}
