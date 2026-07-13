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
        target:
          process.env.INCIDENT_API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // vendor-terminal (~340kB) is the largest intentional chunk; xterm ships with gameplay UI.
    chunkSizeWarningLimit: 360,
    rolldownOptions: {
      output: {
        codeSplitting: {
          minSize: 20_000,
          groups: [
            {name: 'vendor-terminal', test: /node_modules\/@xterm\//},
            {
              name: 'vendor-runtime',
              test: /node_modules\/(?:@cloudflare\/sandbox|effect)\//,
            },
            {
              name: 'vendor-preact',
              test: /node_modules\/(?:preact|@preact|@prefresh)\//,
            },
            {name: 'vendor', test: /node_modules\//},
          ],
        },
      },
    },
  },
});
