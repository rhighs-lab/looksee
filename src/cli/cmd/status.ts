import { resolveActor } from '@/cli/actor.js';
import { liveSession, pinShort } from '@/cli/cmd/session.js';
import type { RunCtx } from '@/cli/commands.js';
import { discover, repoRootOf } from '@/cli/daemon.js';
import { client } from '@/cli/http.js';
import { format } from '@/cli/output.js';
import type { Comment, RepoState, Review, Session } from '@/shared/protocol.js';

export const runStatus = async ({ flags, io }: RunCtx): Promise<number> => {
  const pretty = flags['pretty'] === true;
  const url = io.env['LOOKSEE_URL'];
  const running = url ? { url, pid: null } : await discover(await repoRootOf());
  if (!running) {
    io.out(
      format(
        {
          running: false,
          url: null,
          pid: null,
          title: null,
          pendingReviews: 0,
          openThreads: 0,
          scope: null,
          openedAt: null,
          approvedAt: null,
          drift: false,
        },
        pretty
      )
    );
    return 0;
  }
  const api = client(running.url, resolveActor({}, io.env));
  const [{ reviews }, { comments }, session, state] = await Promise.all([
    api.get<{ reviews: Review[] }>('/api/reviews?state=pending'),
    api.get<{ comments: Comment[] }>('/api/comments?status=open&roots=1'),
    api.get<Session | null>('/api/session'),
    api.get<RepoState>('/api/state'),
  ]);
  const live = liveSession(session);
  io.out(
    format(
      {
        running: true,
        url: running.url,
        pid: running.pid,
        title: state.title,
        pendingReviews: reviews.length,
        openThreads: comments.length,
        scope: live?.scope ?? null,
        openedAt: pinShort(live?.openedAt),
        approvedAt: pinShort(live?.approvedAt),
        drift: state.drift,
      },
      pretty
    )
  );
  return 0;
};
