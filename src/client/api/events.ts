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
      try {
        onEvent(JSON.parse(e.data) as ServerEvent);
      } catch {
        /* malformed frame */
      }
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
