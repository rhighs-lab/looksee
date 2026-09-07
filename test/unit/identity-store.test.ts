import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/client/api/client.js';
import { useIdentities } from '@/client/store/identities.js';
import type { Identity } from '@/shared/protocol.js';

const identity = (actor: string): Identity => ({
  actor,
  name: actor,
  login: actor,
  avatarUrl: `https://github.com/${actor}.png`,
});

describe('identity store', () => {
  beforeEach(() => useIdentities.setState({ byActor: {} }));
  afterEach(() => vi.restoreAllMocks());

  it('requests an answer author even when no comment has that author', async () => {
    const request = vi.spyOn(api, 'identities').mockResolvedValue({
      identities: [identity('codex')],
    });
    await useIdentities.getState().load('codex');
    expect(request).toHaveBeenCalledWith('codex');
    expect(useIdentities.getState().byActor['codex']).toEqual(
      identity('codex')
    );
  });

  it('loads different authors concurrently without losing either result', async () => {
    const request = vi
      .spyOn(api, 'identities')
      .mockImplementation(async (actor) => ({
        identities: [identity(actor ?? 'user')],
      }));
    await Promise.all([
      useIdentities.getState().load('codex'),
      useIdentities.getState().load('cursor'),
      useIdentities.getState().load('codex'),
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(Object.keys(useIdentities.getState().byActor).sort()).toEqual([
      'codex',
      'cursor',
    ]);
    await useIdentities.getState().load('codex');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('can retry after an unsuccessful lookup', async () => {
    const request = vi
      .spyOn(api, 'identities')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ identities: [identity('codex')] });
    await useIdentities.getState().load('codex');
    await useIdentities.getState().load('codex');
    expect(request).toHaveBeenCalledTimes(2);
    expect(useIdentities.getState().byActor['codex']).toBeDefined();
  });
});
