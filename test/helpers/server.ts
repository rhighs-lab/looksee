import type { AddressInfo } from 'node:net';
import { type ServerType, serve } from '@hono/node-server';
import { createApp, type LookseeApp } from '@/server/app.js';
import type { AppOpts } from '@/server/context.js';
import type { ServerEvent } from '@/shared/protocol.js';

export interface TestServer {
  looksee: LookseeApp;
  base: string;
  port: number;
  json<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<{ status: number; body: T }>;
  events(): Promise<EventTap>;
  close(): Promise<void>;
}

export interface EventTap {
  next(type: ServerEvent['type'], timeoutMs?: number): Promise<ServerEvent>;
  all(): ServerEvent[];
  close(): void;
}

export async function startTestServer(opts: AppOpts): Promise<TestServer> {
  const looksee = createApp({ debounceMs: 40, ...opts });
  await looksee.start();
  const server: ServerType = await new Promise((resolve) => {
    const s = serve(
      { fetch: looksee.app.fetch, hostname: '127.0.0.1', port: 0 },
      () => resolve(s)
    );
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const taps: EventTap[] = [];
  return {
    looksee,
    base,
    port,
    async json(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* non-json */
      }
      return { status: res.status, body: parsed as never };
    },
    async events() {
      const ctrl = new AbortController();
      const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const received: ServerEvent[] = [];
      const waiters: Array<{
        type: string;
        resolve: (e: ServerEvent) => void;
      }> = [];
      let buf = '';
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const data = frame
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trim())
                .join('\n');
              if (!data) continue;
              const ev = JSON.parse(data) as ServerEvent;
              received.push(ev);
              const i = waiters.findIndex((w) => w.type === ev.type);
              if (i >= 0) waiters.splice(i, 1)[0]!.resolve(ev);
            }
          }
        } catch {
          /* aborted */
        }
      })();
      const tap: EventTap = {
        next(type, timeoutMs = 5000) {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`timed out waiting for ${type}`)),
              timeoutMs
            );
            waiters.push({
              type,
              resolve: (e) => {
                clearTimeout(timer);
                resolve(e);
              },
            });
          });
        },
        all: () => received.slice(),
        close: () => ctrl.abort(),
      };
      taps.push(tap);
      return tap;
    },
    async close() {
      for (const t of taps) t.close();
      looksee.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
