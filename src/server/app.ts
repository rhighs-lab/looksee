import fs from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { AppContext, AppOpts } from '@/server/context.js';
import { gitDir } from '@/server/git/exec.js';
import { ensureSession } from '@/server/review/session.js';
import { repoRoutes } from '@/server/routes/repo.js';
import { reviewRoutes } from '@/server/routes/review.js';
import { sampleState } from '@/server/sample.js';
import { EventHub } from '@/server/watch/events.js';
import { RepoWatcher } from '@/server/watch/watcher.js';
import type { RepoState } from '@/shared/protocol.js';

export interface LookseeApp {
  app: Hono;
  ctx: AppContext;
  start(): Promise<void>;
  stop(): void;
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export function createApp(opts: AppOpts): LookseeApp {
  const hub = new EventHub();
  const repoRoot = opts.repoRoot;
  const watcher = repoRoot
    ? new RepoWatcher(
        repoRoot,
        {
          baseFlag: opts.defaultBase ?? null,
          ...(opts.debounceMs !== undefined
            ? { debounceMs: opts.debounceMs }
            : {}),
        },
        hub
      )
    : null;
  const sample = sampleState();
  const ctx: AppContext = {
    repoRoot,
    hub,
    watcher,
    clientDir: opts.clientDir ?? null,
    state: (): RepoState => (watcher ? watcher.state : sample),
    statusDigest: (): string | null => watcher?.statusDigest ?? null,
  };

  const app = new Hono();

  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    const origin = c.req.header('origin');
    const host = c.req.header('host');
    const proto = new URL(c.req.url).protocol;
    if (!origin || origin === `${proto}//${host}`) return next();
    return c.json({ error: 'cross-origin request rejected' }, 403);
  });

  app.route('/', repoRoutes(ctx));
  app.route('/', reviewRoutes(ctx));

  if (ctx.clientDir) {
    const dir = ctx.clientDir;
    app.use(
      '/assets/*',
      serveStatic({ root: path.relative(process.cwd(), dir) || '.' })
    );
    app.get('*', async (c) => {
      const url = new URL(c.req.url);
      if (url.pathname.startsWith('/api/'))
        return c.json({ error: 'not found' }, 404);
      const rel =
        url.pathname === '/' || url.pathname.startsWith('/file/')
          ? 'index.html'
          : url.pathname.slice(1);
      const abs = path.resolve(dir, rel);
      if (!abs.startsWith(path.resolve(dir) + path.sep))
        return c.text('not found', 404);
      try {
        const buf = await fs.readFile(abs);
        return c.body(buf, 200, {
          'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream',
        });
      } catch {
        const index = await fs
          .readFile(path.join(dir, 'index.html'))
          .catch(() => null);
        return index
          ? c.body(index, 200, { 'content-type': 'text/html' })
          : c.text('not found', 404);
      }
    });
  }

  return {
    app,
    ctx,
    async start() {
      if (!watcher || !repoRoot) return;
      const gd = await gitDir(repoRoot).catch(() => null);
      const session = gd
        ? await ensureSession(repoRoot).catch((err: unknown) => {
            console.error(`looksee: session pin failed: ${String(err)}`);
            return null;
          })
        : null;
      await watcher.start({
        gitDir: gd,
        preset: session?.scope ?? 'session',
        custom: session?.custom ?? null,
      });
    },
    stop() {
      watcher?.stop();
    },
  };
}
