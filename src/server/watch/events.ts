import type { ServerEvent } from '@/shared/protocol.js';

export type Listener = (ev: ServerEvent) => void;

export class EventHub {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev: ServerEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch {
        this.listeners.delete(fn);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
