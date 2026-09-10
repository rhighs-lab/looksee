import { ensureHighlightStyles } from '@/client/api/client.js';
import type { ServerEvent } from '@/shared/protocol.js';

export type Connection = 'off' | 'connecting' | 'live' | 'reconnecting';

export interface EventSubscription {
  close(): void;
}

export function connectEvents(
  onEvent: (ev: ServerEvent) => void,
  onStatus: (s: Connection) => void
): EventSubscription {
  if (
    typeof EventSource === 'undefined' ||
    new URLSearchParams(location.search).get('live') === '0'
  ) {
    onStatus('off');
    return { close() {} };
  }
  let es: EventSource | null = null;
  let everOpened = false;
  let closed = false;
  let chain: Promise<void> = Promise.resolve();
  onStatus('connecting');

  const open = () => {
    if (closed) return;
    es = new EventSource('/api/events');
    es.onopen = () => {
      onStatus('live');
      if (everOpened) onEvent({ type: 'hello', version: -1 });
      everOpened = true;
    };
    es.onmessage = (e) => {
      let ev: ServerEvent & { hl?: number };
      try {
        ev = JSON.parse(e.data) as ServerEvent & { hl?: number };
      } catch {
        return;
      }
      const { hl, ...rest } = ev;
      chain = chain
        .then(() => ensureHighlightStyles(hl === undefined ? null : String(hl)))
        .then(() => onEvent(rest as ServerEvent));
    };
    es.onerror = () => {
      onStatus('reconnecting');
      if (es && es.readyState === EventSource.CLOSED) {
        es.close();
        es = null;
        setTimeout(open, 2000);
      }
    };
  };
  open();
  return {
    close() {
      closed = true;
      es?.close();
      es = null;
    },
  };
}
