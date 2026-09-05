export interface DesktopConfig {
  freesoundClientId: string
  tokenWorkerUrl: string
}

function read(key: keyof ImportMetaEnv): string {
  return import.meta.env[key] ?? process.env[key] ?? ''
}

export function loadConfig(): DesktopConfig {
  const freesoundClientId = read('FREESOUND_CLIENT_ID')
  const tokenWorkerUrl = read('FREESOUND_TOKEN_WORKER_URL')
  if (!freesoundClientId || !tokenWorkerUrl) {
    console.warn(
      '[config] FREESOUND_CLIENT_ID and/or FREESOUND_TOKEN_WORKER_URL are not set — ' +
        'sign-in is disabled, and with it search (ADR-0004: the app bundles no API key, ' +
        'so every Freesound call needs the user OAuth token). Copy ' +
        'apps/desktop/.env.example to apps/desktop/.env and fill both in. ' +
        'FREESOUND_CLIENT_SECRET is NEVER read here — it lives only in the token Worker.',
    )
  }

  return {
    freesoundClientId,
    tokenWorkerUrl,
  }
}
