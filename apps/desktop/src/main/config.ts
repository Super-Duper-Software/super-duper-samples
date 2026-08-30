// Reads configuration from `.env` via electron-vite's env handling. No secret is
// committed; `.env` is git-ignored and `.env.example` documents the keys.

export interface DesktopConfig {
  freesoundApiKey: string
  freesoundClientId: string
  tokenWorkerUrl: string
}

function read(key: keyof ImportMetaEnv): string {
  return import.meta.env[key] ?? process.env[key] ?? ''
}

export function loadConfig(): DesktopConfig {
  const freesoundApiKey = read('FREESOUND_API_KEY')
  if (!freesoundApiKey) {
    console.warn(
      '[config] FREESOUND_API_KEY is not set — search will fail with HTTP 401. ' +
        'Copy apps/desktop/.env.example to apps/desktop/.env and add your key.',
    )
  }
  return {
    freesoundApiKey,
    freesoundClientId: read('FREESOUND_CLIENT_ID'),
    tokenWorkerUrl: read('FREESOUND_TOKEN_WORKER_URL'),
  }
}
