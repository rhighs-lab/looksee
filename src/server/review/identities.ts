import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ghJson, pick } from '@/server/review/gh-avatars.js';
import {
  lookseeHome,
  withLock,
  writeJsonAtomic,
} from '@/server/review/store.js';
import { AGENT_LOGIN } from '@/shared/harnesses.js';
import { type Identity, USER_ACTOR } from '@/shared/protocol.js';

const FALLBACK_NAME: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  pi: 'Pi',
  cursor: 'Cursor',
  aider: 'Aider',
  'gemini-cli': 'Gemini CLI',
  agent: 'agent',
};

interface Entry extends Omit<Identity, 'actor'> {
  at: number;
}

const DAY = 86_400_000;
const HIT_TTL = 30 * DAY;
const MISS_TTL = DAY;

const file = () => path.join(lookseeHome(), 'identities.json');

const readCache = async (): Promise<Record<string, Entry>> => {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as Record<
      string,
      Entry
    >;
  } catch {
    return {};
  }
};

const fresh = (e: Entry | undefined): boolean =>
  !!e && Date.now() - e.at < (e.login ? HIT_TTL : MISS_TTL);

const git = (repoRoot: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile('git', ['-C', repoRoot, ...args], { timeout: 3000 }, (err, out) =>
      resolve(err ? '' : out.trim())
    );
  });

const GH_NOREPLY = /^(?:\d+\+)?([\w-]+)@users\.noreply\.github\.com$/i;

const userOf = async (login: string): Promise<Omit<Entry, 'at'> | null> => {
  const d = await ghJson(`https://api.github.com/users/${login}`);
  const l = pick(d, 'login');
  if (!l) return null;
  return {
    login: l,
    name: pick(d, 'name') ?? l,
    avatarUrl: pick(d, 'avatar_url'),
  };
};

/**
 * Who is driving this checkout: the git email resolved to a GitHub account,
 * falling back to the account the gh CLI is signed in as. Both beat printing
 * the word "user".
 */
async function resolveLocalUser(repoRoot: string): Promise<Omit<Entry, 'at'>> {
  const email = await git(repoRoot, ['config', 'user.email']);
  const gitName = await git(repoRoot, ['config', 'user.name']);
  const bare: Omit<Entry, 'at'> = {
    login: null,
    name: gitName || USER_ACTOR,
    avatarUrl: null,
  };

  const noreply = GH_NOREPLY.exec(email)?.[1];
  if (noreply) return (await userOf(noreply)) ?? bare;

  if (email) {
    const hit = (await ghJson(
      `https://api.github.com/search/users?q=${encodeURIComponent(`${email} in:email`)}`
    )) as { items?: unknown[] } | null;
    const first = hit?.items?.[0];
    const login = pick(first, 'login');
    if (login) return (await userOf(login)) ?? bare;
  }

  const me = await ghJson('https://api.github.com/user');
  const login = pick(me, 'login');
  if (login)
    return {
      login,
      name: pick(me, 'name') ?? login,
      avatarUrl: pick(me, 'avatar_url'),
    };
  return bare;
}

const miss = (actor: string): Omit<Entry, 'at'> => ({
  login: null,
  name: FALLBACK_NAME[actor] ?? actor,
  avatarUrl: null,
});

/**
 * Names and faces for the actors a page is about to render. Cached on disk;
 * Known harnesses keep their public avatar URL even when the API lookup fails.
 */
export async function resolveIdentities(
  repoRoot: string | null,
  actors: string[]
): Promise<Identity[]> {
  const wanted = [...new Set(actors)];
  const cache = await readCache();
  let dirty = false;

  for (const actor of wanted) {
    if (fresh(cache[actor])) continue;
    const found =
      actor === USER_ACTOR
        ? repoRoot
          ? await resolveLocalUser(repoRoot)
          : miss(actor)
        : AGENT_LOGIN[actor]
          ? ((await userOf(AGENT_LOGIN[actor]!)) ?? miss(actor))
          : miss(actor);
    cache[actor] = { ...found, at: Date.now() };
    dirty = true;
  }

  if (dirty)
    await withLock('identities', () => writeJsonAtomic(file(), cache)).catch(
      () => undefined
    );

  return wanted.map((actor) => {
    const e = cache[actor];
    return {
      actor,
      login: e?.login ?? null,
      name: e?.name ?? FALLBACK_NAME[actor] ?? actor,
      avatarUrl:
        e?.avatarUrl ??
        (AGENT_LOGIN[actor]
          ? `https://github.com/${AGENT_LOGIN[actor]}.png`
          : null),
    };
  });
}
