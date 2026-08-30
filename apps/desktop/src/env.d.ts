// Env vars exposed to the main process by electron-vite (`envPrefix` in
// electron.vite.config.ts). The renderer never sees these.

interface ImportMetaEnv {
  readonly FREESOUND_API_KEY?: string
  readonly FREESOUND_CLIENT_ID?: string
  readonly FREESOUND_TOKEN_WORKER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
