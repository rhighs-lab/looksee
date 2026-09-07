import type { RunCtx } from '@/cli/commands.js';
import { connect } from '@/cli/connect.js';
import { type Expects, expectsFor, expectsForVerdict } from '@/cli/expects.js';
import { EVENTS, preamble } from '@/cli/guide.js';
import { events } from '@/cli/sse.js';
import type {
  DecoratedComment,
  Review,
  ServerEvent,
} from '@/shared/protocol.js';

type Hinted = DecoratedComment & { expects: Expects };
type Line = Record<string, unknown> & { type: string };

const KEEP = new Set<string>(EVENTS.map(([t]) => t));

const hint = (c: DecoratedComment): Hinted => ({
  ...c,
  expects: expectsFor(c),
});

const shape = (ev: ServerEvent): Line | null => {
  switch (ev.type) {
    case 'comment.created':
    case 'comment.replied':
      return { ...ev, comment: hint(ev.comment) };
    case 'review.submitted':
      return {
        ...ev,
        comments: ev.comments.map(hint),
        expects: ev.review.verdict
          ? expectsForVerdict(ev.review.verdict)
          : null,
      };
    default:
      return KEEP.has(ev.type) ? { ...ev } : null;
  }
};

const authorOf = (l: Line): string | null => {
  const c = l['comment'] as DecoratedComment | undefined;
  const r = l['review'] as Review | undefined;
  const a = l['actor'];
  return c?.author ?? r?.author ?? (typeof a === 'string' ? a : null);
};

const pending = async (
  http: { get: <T>(p: string) => Promise<T> },
  actor: string
): Promise<Line[]> => {
  const [{ comments }, { reviews }] = await Promise.all([
    http.get<{ comments: DecoratedComment[] }>('/api/comments'),
    http.get<{ reviews: Review[] }>('/api/reviews?state=submitted'),
  ]);
  const openReviewIds = new Set(
    comments
      .filter((c) => !c.parentId && c.status === 'open' && c.reviewId)
      .map((c) => c.reviewId as string)
  );
  const undone = reviews
    .filter((r) => r.verdict === 'request_changes' && openReviewIds.has(r.id))
    .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  const covered = new Set(undone.map((r) => r.id));
  const open = comments.filter((c) => c.status === 'open');
  const answered = new Set(
    open.filter((c) => c.parentId && c.author === actor).map((c) => c.parentId)
  );
  const roots = open.filter(
    (c) =>
      !c.parentId &&
      !answered.has(c.id) &&
      !(c.reviewId && covered.has(c.reviewId))
  );
  return [
    ...undone.map((review) => ({
      type: 'review.submitted',
      review,
      comments: open
        .filter((c) => c.reviewId === review.id && !c.parentId)
        .map(hint),
      expects: expectsForVerdict('request_changes'),
      origin: null,
      replay: true,
    })),
    ...roots.map((c) => ({
      type: 'comment.created',
      comment: hint(c),
      origin: null,
      replay: true,
    })),
  ];
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((res) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      res();
    });
  });

export const runListen = async ({ flags, io }: RunCtx): Promise<number> => {
  const { url, actor, http } = await connect(flags, io.env);
  const signal = io.signal;
  const notMe = flags['not-me'] === true;
  const waitSec = Number(flags['wait']);
  const waitMs = Number.isFinite(waitSec) && waitSec > 0 ? waitSec * 1000 : 0;
  const write = (l: Line): void => void io.out(`${JSON.stringify(l)}\n`);
  let printed = false;
  const print = (l: Line): void => {
    if (notMe && authorOf(l) === actor) return;
    write(l);
    printed = true;
  };
  write({
    type: 'hello',
    actor,
    ...(flags['quiet'] === true ? {} : { guide: preamble() }),
  });
  if (flags['pending'] === true)
    for (const l of await pending(http, actor)) print(l);
  if (waitMs && printed) return 0;
  const headers = {
    'x-looksee-actor': actor,
    'x-looksee-client': `cli-${process.pid}`,
  };
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal?.addEventListener('abort', stop);
  const timer = waitMs ? setTimeout(stop, waitMs) : null;
  const until = ctl.signal;
  const window = Number(io.env['LOOKSEE_RETRY_MS']) || 10_000;
  const step = Math.min(1000, window);
  let lost: number | null = null;
  try {
    while (!until.aborted) {
      try {
        for await (const ev of events(url, headers, until)) {
          lost = null;
          const l = shape(ev);
          if (l) print(l);
          if (waitMs && printed) return 0;
        }
        return 0;
      } catch {
        lost ??= Date.now();
        if (Date.now() - lost >= window) {
          io.err(`lost connection to ${url}\n`);
          return 1;
        }
        await sleep(step, until);
      }
    }
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
};
