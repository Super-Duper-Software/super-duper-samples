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

  const freesoundClientId = read('FREESOUND_CLIENT_ID')
  const tokenWorkerUrl = read('FREESOUND_TOKEN_WORKER_URL')
  if (!freesoundClientId || !tokenWorkerUrl) {
    console.warn(
      '[config] FREESOUND_CLIENT_ID and/or FREESOUND_TOKEN_WORKER_URL are not set — ' +
        'OAuth sign-in is disabled (search and Preview still work). ' +
        'FREESOUND_CLIENT_SECRET is NEVER read here — it lives only in the token Worker (ADR-0004).',
    )
  }

  return {
    freesoundApiKey,
    freesoundClientId,
    tokenWorkerUrl,
  }
}
