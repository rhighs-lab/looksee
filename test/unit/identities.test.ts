import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveIdentities } from '@/server/review/identities.js';

describe('resolveIdentities', () => {
  let home: string;

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'looksee-ids-'));
    process.env['LOOKSEE_HOME'] = home;
    await fs.writeFile(
      path.join(home, 'identities.json'),
      JSON.stringify({
        'claude-code': {
          login: 'claude',
          name: 'Claude',
          avatarUrl: 'https://avatars.githubusercontent.com/u/81847?v=4',
          at: Date.now(),
        },
        user: {
          login: 'rhighs',
          name: 'Roberto Montalti',
          avatarUrl: 'https://avatars.githubusercontent.com/u/37136851?v=4',
          at: Date.now(),
        },
        codex: {
          login: null,
          name: 'Codex',
          avatarUrl: null,
          at: Date.now(),
        },
      })
    );
  });

  afterAll(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('serves a cached identity without asking GitHub again', async () => {
    const [agent, user] = await resolveIdentities(null, [
      'claude-code',
      'user',
    ]);
    expect(agent).toEqual({
      actor: 'claude-code',
      login: 'claude',
      name: 'Claude',
      avatarUrl: 'https://avatars.githubusercontent.com/u/81847?v=4',
    });
    expect(user?.name).toBe('Roberto Montalti');
  });

  it('falls back to a readable name for an actor it cannot resolve', async () => {
    const [only] = await resolveIdentities(null, ['pi']);
    expect(only).toEqual({
      actor: 'pi',
      login: null,
      name: 'Pi',
      avatarUrl: null,
    });
  });

  it('de-duplicates the actors it was asked for', async () => {
    const out = await resolveIdentities(null, ['user', 'user', 'claude-code']);
    expect(out.map((i) => i.actor)).toEqual(['user', 'claude-code']);
  });

  it('uses the known harness avatar even when a cached GitHub lookup failed', async () => {
    const [codex] = await resolveIdentities(null, ['codex']);
    expect(codex?.avatarUrl).toBe('https://github.com/openai.png');
  });
});
