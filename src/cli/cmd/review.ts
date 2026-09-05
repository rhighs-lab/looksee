import open from 'open';
import { resolveActor } from '@/cli/actor.js';
import { assertCliPreset } from '@/cli/cmd/session.js';
import type { RunCtx } from '@/cli/commands.js';
import { ensureServer, repoRootOf } from '@/cli/daemon.js';
import { client } from '@/cli/http.js';
import { format } from '@/cli/output.js';
import type { RepoState } from '@/shared/protocol.js';

export const runReview = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const root = await repoRootOf(positionals[0]);
  const want =
    typeof flags['scope'] === 'string'
      ? {
          preset: assertCliPreset(flags['scope']),
          actor: resolveActor({}, io.env),
        }
      : null;
  const base = typeof flags['base'] === 'string' ? flags['base'] : null;
  const title = typeof flags['title'] === 'string' ? flags['title'] : null;
  const running = await ensureServer(root, { base, title });
  if (want)
    await client(running.url, want.actor)
      .post<RepoState>('/api/scope', { preset: want.preset })
      .catch((e: unknown) =>
        io.err(
          `could not set scope ${want.preset}: ${e instanceof Error ? e.message : String(e)}\n`
        )
      );
  if (!flags['no-open']) await open(running.url).catch(() => {});
  const pretty = flags['pretty'] === true;
  io.out(format(pretty ? running.url : { url: running.url }, pretty));
  return 0;
};
