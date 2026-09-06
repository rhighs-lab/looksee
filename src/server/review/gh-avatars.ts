import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  lookseeHome,
  withLock,
  writeJsonAtomic,
} from '@/server/review/store.js';
import { parseRemote } from '@/shared/forge.js';
import type { CommitContributor } from '@/shared/protocol.js';

interface Entry {
  login: string | null;
  avatarUrl: string | null;
  at: number;
}

const DAY = 86_400_000;
const HIT_TTL = 30 * DAY;
const MISS_TTL = DAY;
const TIMEOUT_MS = 4000;

const file = () => path.join(lookseeHome(), 'gh-avatars.json');

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

let cachedToken: string | null | undefined;

/** Private repos need auth; fall back to the gh CLI's token, as blame
 *  extensions do, so a logged-in user needs no extra setup. */
function ghToken(): Promise<string | null> {
  const env = process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'];
  if (env) return Promise.resolve(env);
  if (cachedToken !== undefined) return Promise.resolve(cachedToken);
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 3000 }, (err, out) => {
      cachedToken = err ? null : out.trim() || null;
      resolve(cachedToken);
    });
  });
}

export async function ghJson(url: string): Promise<unknown | null> {
  const token = await ghToken();
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'looksee',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export const pick = (v: unknown, k: string): string | null => {
  const o = v as Record<string, unknown> | null;
  const s = o?.[k];
  return typeof s === 'string' ? s : null;
};

/** The commit endpoint resolves author and committer for us, no email search. */
async function fromCommit(
  remoteUrl: string,
  sha: string
): Promise<Map<string, Entry>> {
  const out = new Map<string, Entry>();
  const repo = parseRemote(remoteUrl);
  if (!repo || repo.host !== 'github.com') return out;
  const data = (await ghJson(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${sha}`
  )) as Record<string, unknown> | null;
  if (!data) return out;
  const commit = data['commit'] as Record<string, unknown> | undefined;
  for (const side of ['author', 'committer'] as const) {
    const email = pick(commit?.[side], 'email');
    const login = pick(data[side], 'login');
    const avatarUrl = pick(data[side], 'avatar_url');
    if (email && login)
      out.set(email.toLowerCase(), { login, avatarUrl, at: Date.now() });
  }
  return out;
}

async function searchByEmail(email: string): Promise<Entry> {
  const data = (await ghJson(
    `https://api.github.com/search/users?q=${encodeURIComponent(`${email} in:email`)}`
  )) as { items?: unknown[] } | null;
  const first = data?.items?.[0];
  return {
    login: pick(first, 'login'),
    avatarUrl: pick(first, 'avatar_url'),
    at: Date.now(),
  };
}

/**
 * Fills in avatarUrl from GitHub, cached on disk so a repeat view costs
 * nothing. Every failure is silent: an unresolved contributor just keeps the
 * generated identicon.
 */
export async function resolveAvatars(
  remoteUrl: string | null,
  sha: string,
  people: CommitContributor[]
): Promise<CommitContributor[]> {
  const repo = remoteUrl ? parseRemote(remoteUrl) : null;
  if (repo?.host !== 'github.com') return people;
  const cache = await readCache();
  const wanted = people.filter(
    (p) => p.email && !fresh(cache[p.email.toLowerCase()])
  );
  if (!wanted.length) return apply(people, cache);

  const found = await fromCommit(remoteUrl!, sha);
  for (const [email, entry] of found) cache[email] = entry;

  for (const p of wanted) {
    const key = p.email.toLowerCase();
    if (fresh(cache[key])) continue;
    cache[key] = p.login
      ? {
          login: p.login,
          avatarUrl: `https://github.com/${p.login}.png`,
          at: Date.now(),
        }
      : await searchByEmail(p.email);
  }

  await withLock('gh-avatars', () => writeJsonAtomic(file(), cache)).catch(
    () => undefined
  );
  return apply(people, cache);
}

const apply = (
  people: CommitContributor[],
  cache: Record<string, Entry>
): CommitContributor[] =>
  people.map((p) => {
    const e = cache[p.email.toLowerCase()];
    return {
      ...p,
      login: e?.login ?? p.login,
      avatarUrl: e?.avatarUrl ?? null,
    };
  });
