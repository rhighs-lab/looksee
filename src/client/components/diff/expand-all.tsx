import {
  boundaries,
  type Dir,
  remainingGaps,
} from '@/client/components/diff/rows.js';
import type { Expansions } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';
import type { FileDiff } from '@/shared/protocol.js';

export interface ExpansionApi {
  expansions: Expansions | undefined;
  expand: (
    gap: {
      boundary: string;
      start: number;
      end: number;
      offset: number;
      dirs: Dir[];
      header: string;
    },
    dir: Dir
  ) => void;
  collapseAll: () => void;
}

export function ExpandAllButton({
  diff,
  expansions,
  expand,
  collapseAll,
}: { diff: FileDiff } & ExpansionApi) {
  const bs = boundaries(diff);
  const open = bs.flatMap((b) =>
    remainingGaps(b, expansions?.[b.key] ?? []).map((g) => ({ b, g }))
  );
  const loaded = Boolean(expansions && Object.keys(expansions).length);
  if (!open.length && !loaded) return null;
  const onClick = () => {
    if (!open.length) return collapseAll();
    for (const { b, g } of open)
      expand(
        {
          boundary: b.key,
          start: g.start,
          end: g.end,
          offset: b.offset,
          dirs: [],
          header: '',
        },
        'all'
      );
  };
  return (
    <Button small onClick={onClick}>
      {open.length ? 'Expand all' : 'Collapse'}
    </Button>
  );
}
