import { useReview } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';

const scrollToArrival = (seq: number, paths: string[]): void => {
  const cell = document.querySelector<HTMLElement>(
    `.blob-num[data-arrival="${seq}"]`
  );
  const target =
    cell?.closest('tr') ??
    paths
      .map((p) =>
        document.querySelector<HTMLElement>(
          `.file[data-path="${CSS.escape(p)}"]`
        )
      )
      .find(Boolean);
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
};

export function ArrivalJump() {
  const on = useReview((s) => s.newLineAttention);
  const arrivals = useReview((s) => s.arrivals);
  const acknowledge = useReview((s) => s.acknowledgeArrival);
  if (!on) return null;

  const seqs = Object.values(arrivals).flatMap((ls) => ls.map((l) => l.seq));
  if (!seqs.length) return null;
  const newest = Math.max(...seqs);
  const pending = new Set(seqs).size;
  const paths = Object.entries(arrivals)
    .filter(([, ls]) => ls.some((l) => l.seq === newest))
    .map(([p]) => p);

  return (
    <Button
      small
      className="arrival-jump"
      title="Jump to the lines that arrived most recently"
      onClick={() => {
        scrollToArrival(newest, paths);
        acknowledge(newest);
      }}
    >
      <span className="arrival-dot" aria-hidden="true" />
      {pending} new
    </Button>
  );
}
