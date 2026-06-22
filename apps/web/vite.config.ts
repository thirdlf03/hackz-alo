import {defineConfig} from 'vite';
import preact from '@preact/preset-vite';
import {fileURLToPath, URL} from 'node:url';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const sharedEntry = fileURLToPath(
  new URL('../../packages/shared/src/index.ts', import.meta.url)
);

export default defineConfig({
  root: webRoot,
  plugins: [preact()],
  resolve: {
    alias: {
      '@incident/shared': sharedEntry,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [workspaceRoot],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
