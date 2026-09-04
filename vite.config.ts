import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = Number(process.env.LOOKSEE_API_PORT || 4711);

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
        bypass: (req) =>
          /^\/api\/(client|events)\.ts(\?|$)/.test(req.url ?? '')
            ? req.url
            : undefined,
      },
      '/attachments': `http://127.0.0.1:${apiPort}`,
      '/healthz': `http://127.0.0.1:${apiPort}`,
    },
  },
});
