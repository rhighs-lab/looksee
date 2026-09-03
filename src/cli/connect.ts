import { resolveActor } from '@/cli/actor.js';
import { ensureServer, repoRootOf } from '@/cli/daemon.js';
import { type Client, client } from '@/cli/http.js';

export interface Conn {
  url: string;
  actor: string;
  http: Client;
}

export const connect = async (
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv
): Promise<Conn> => {
  const actor = resolveActor(flags, env);
  const url =
    env['LOOKSEE_URL'] || (await ensureServer(await repoRootOf())).url;
  return { url, actor, http: client(url, actor) };
};
