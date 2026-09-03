import type { RunCtx } from '@/cli/commands.js';
import { connect } from '@/cli/connect.js';
import { type Expects, expectsFor, expectsForVerdict } from '@/cli/expects.js';
import { EVENTS, preamble } from '@/cli/guide.js';
import { events } from '@/cli/sse.js';
import type {
  DecoratedComment,
  DoneMark,
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
  const [{ comments }, { reviews }, { done }] = await Promise.all([
    http.get<{ comments: DecoratedComment[] }>('/api/comments'),
    http.get<{ reviews: Review[] }>('/api/reviews?state=submitted'),
    http.get<{ done: DoneMark[] }>('/api/done'),
  ]);
  const doneAt = done
    .filter((d) => d.actor === actor)
    .map((d) => d.at)
    .sort()
    .at(-1);
  const undone = reviews
    .filter(
      (r) =>
        r.verdict === 'request_changes' &&
        (!doneAt || !r.submittedAt || doneAt <= r.submittedAt)
    )
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
  const write = (l: Line): void => void io.out(`${JSON.stringify(l)}\n`);
  const print = (l: Line): void => {
    if (notMe && authorOf(l) === actor) return;
    write(l);
  };
  write({
    type: 'hello',
    actor,
    ...(flags['quiet'] === true ? {} : { guide: preamble() }),
  });
  if (flags['pending'] === true)
    for (const l of await pending(http, actor)) print(l);
  const headers = {
    'x-looksee-actor': actor,
    'x-looksee-client': `cli-${process.pid}`,
  };
  const window = Number(io.env['LOOKSEE_RETRY_MS']) || 10_000;
  const step = Math.min(1000, window);
  let lost: number | null = null;
  while (!signal?.aborted) {
    try {
      for await (const ev of events(url, headers, signal)) {
        lost = null;
        const l = shape(ev);
        if (l) print(l);
      }
      return 0;
    } catch {
      lost ??= Date.now();
      if (Date.now() - lost >= window) {
        io.err(`lost connection to ${url}\n`);
        return 1;
      }
      await sleep(step, signal);
    }
  }
  return 0;
};
