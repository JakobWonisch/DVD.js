import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [solid()],
  root,
  base: '/',
  publicDir: resolve(root, 'public'),
  build: {
    outDir: resolve(root, '../dist/viewer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/dvds.json': 'http://127.0.0.1:3000',
      '/api': 'http://127.0.0.1:3000',
      // Cover / poster sidecars next to archives (Foo.cover.jpg, Foo.poster.jpg).
      '^/[^/]+\\.cover\\.jpg$': 'http://127.0.0.1:3000',
      '^/[^/]+\\.poster\\.jpg$': 'http://127.0.0.1:3000',
      // Converted disc assets live under webFolder, served by pnpm start.
      '^/[^/]+/(metadata\\.json|vm\\.js|.*\\.(webm|png|css|vtt|jpg))$':
        'http://127.0.0.1:3000',
    },
  },
});
