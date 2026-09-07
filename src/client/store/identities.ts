import { create } from 'zustand';
import { api } from '@/client/api/client.js';
import type { Identity } from '@/shared/protocol.js';

interface IdentityState {
  byActor: Record<string, Identity>;
  load: (actor?: string) => Promise<void>;
}

const inFlight = new Map<string, Promise<void>>();

export const useIdentities = create<IdentityState>((set, get) => ({
  byActor: {},
  load: (actor) => {
    if (actor && get().byActor[actor]) return Promise.resolve();
    const key = actor ?? '';
    const pending = inFlight.get(key);
    if (pending) return pending;
    const request = api
      .identities(actor)
      .then(({ identities }) => {
        set((state) => ({
          byActor: {
            ...state.byActor,
            ...Object.fromEntries(identities.map((i) => [i.actor, i])),
          },
        }));
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  },
}));

export const useIdentity = (actor: string): Identity | undefined =>
  useIdentities((s) => s.byActor[actor]);
