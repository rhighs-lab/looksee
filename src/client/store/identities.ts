import { create } from 'zustand';
import { api } from '@/client/api/client.js';
import type { Identity } from '@/shared/protocol.js';

interface IdentityState {
  byActor: Record<string, Identity>;
  load: () => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useIdentities = create<IdentityState>((set) => ({
  byActor: {},
  load: () => {
    inFlight ??= api
      .identities()
      .then(({ identities }) => {
        set({
          byActor: Object.fromEntries(identities.map((i) => [i.actor, i])),
        });
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
}));

export const useIdentity = (actor: string): Identity | undefined =>
  useIdentities((s) => s.byActor[actor]);
