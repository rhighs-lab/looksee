import { resolveActor } from '@/cli/actor.js';
import type { RunCtx } from '@/cli/commands.js';
import { discover, repoRootOf } from '@/cli/daemon.js';
import { client } from '@/cli/http.js';
import { format } from '@/cli/output.js';
import type { Comment, Review } from '@/shared/protocol.js';

export const runStatus = async ({ flags, io }: RunCtx): Promise<number> => {
  const pretty = flags['pretty'] === true;
  const root = await repoRootOf();
  const running = await discover(root);
  if (!running) {
    io.out(
      format(
        {
          running: false,
          url: null,
          pid: null,
          pendingReviews: 0,
          openThreads: 0,
        },
        pretty
      )
    );
    return 0;
  }
  const api = client(running.url, resolveActor({}, io.env));
  const [{ reviews }, { comments }] = await Promise.all([
    api.get<{ reviews: Review[] }>('/api/reviews?state=pending'),
    api.get<{ comments: Comment[] }>('/api/comments?status=open&roots=1'),
  ]);
  io.out(
    format(
      {
        running: true,
        url: running.url,
        pid: running.pid,
        pendingReviews: reviews.length,
        openThreads: comments.length,
      },
      pretty
    )
  );
  return 0;
};
