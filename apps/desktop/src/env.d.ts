interface ImportMetaEnv {
  readonly FREESOUND_CLIENT_ID?: string
  readonly FREESOUND_TOKEN_WORKER_URL?: string
  /** Set to `0` / `false` / `off` / `no` to stop sending the anonymous install id. */
  readonly SDS_TELEMETRY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
