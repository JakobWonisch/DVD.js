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
      '^/[^/]+/(metadata\\.json|vm\\.js|.*\\.(webm|png|css|vtt|jpg))$':
        'http://127.0.0.1:3000',
    },
  },
});
