import type { ServerEvent } from '@/shared/protocol.js';

const frames = (buf: string): { done: ServerEvent[]; rest: string } => {
  const done: ServerEvent[] = [];
  let rest = buf;
  let idx = rest.indexOf('\n\n');
  while (idx >= 0) {
    const lines = rest.slice(0, idx).split('\n');
    rest = rest.slice(idx + 2);
    idx = rest.indexOf('\n\n');
    if (lines.some((l) => l.startsWith('event: ping'))) continue;
    const data = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (data) done.push(JSON.parse(data) as ServerEvent);
  }
  return { done, rest };
};

export async function* events(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal
): AsyncGenerator<ServerEvent> {
  const init: RequestInit = { headers };
  if (signal) init.signal = signal;
  const res = await fetch(`${url}/api/events`, init);
  if (!res.ok || !res.body) throw new Error(`events: http ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  // A caller that stops reading closes the generator; without releasing the
  // body the socket stays open and keeps the process alive.
  try {
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (signal?.aborted) return;
        throw e;
      }
      if (chunk.done) {
        if (signal?.aborted) return;
        throw new Error('connection closed');
      }
      buf += dec.decode(chunk.value, { stream: true });
      const { done, rest } = frames(buf);
      buf = rest;
      for (const ev of done) yield ev;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
