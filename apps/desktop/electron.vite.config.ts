import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The API key is read from `.env` (git-ignored) via electron-vite's env handling.
// `envPrefix` makes `FREESOUND_*` visible to `import.meta.env` in the main process
// only — it is never exposed to the renderer bundle.
export default defineConfig({
  main: {
    envPrefix: ['MAIN_VITE_', 'FREESOUND_'],
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Ticket 12: the peak-computation Worker. A separate entry so it lands
          // at `out/main/peakWorker.js` and can be spawned via `worker_threads`.
          peakWorker: resolve(__dirname, 'src/core/peaks/peakWorker.ts'),
          // Ticket 14: the sidecar-scan Worker for "rebuild from sidecars".
          // Lands at `out/main/rebuildWorker.js`; spawned via `worker_threads`.
          rebuildWorker: resolve(__dirname, 'src/core/rebuild/rebuildWorker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    plugins: [react()],
  },
})
