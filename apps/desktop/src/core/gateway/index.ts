import type { SearchFilter, SearchSort } from '../types'

/**
 * The exact `fields` set requested from `/apiv2/search/text/` — everything a
 * result row needs, so no per-Sound detail request is ever made. Keep in sync
 * with `mapRawSound` and the `Sound` type.
 */
export const SEARCH_FIELDS =
  'id,name,username,license,duration,tags,filesize,type,samplerate,channels,bitdepth,previews,images,url,num_downloads,avg_rating,created'

export interface GatewaySearchParams {
  query: string
  /** 1-based page number. */
  page: number
  pageSize: number
  /** Absent means Freesound's default relevance. See `freesoundSortParam`. */
  sort?: SearchSort
  /** Absent or all-empty means no constraint. See `freesoundFilterString`. */
  filter?: SearchFilter
}

/** A raw Freesound sound object, exactly as it appears in a search response. */
export interface RawFreesoundSound {
  id: number
  name: string
  username: string
  /** License deed URL, e.g. "http://creativecommons.org/licenses/by/3.0/". */
  license: string
  duration: number
  tags: string[]
  filesize: number
  type: string
  samplerate: number
  channels: number
  bitdepth: number
  num_downloads: number
  avg_rating: number
  created: string
  url: string
  previews: {
    'preview-hq-mp3': string
    'preview-lq-mp3': string
    'preview-hq-ogg': string
    'preview-lq-ogg': string
  }
  images: {
    waveform_m: string
    waveform_l: string
    spectral_m?: string
    spectral_l?: string
  }
}

/** A raw `/apiv2/search/text/` response page. */
export interface RawSearchPage {
  count: number
  next: string | null
  previous: string | null
  results: RawFreesoundSound[]
}

/**
 * A normalized OAuth token set from the token Worker's `/exchange` and
 * `/refresh`. Camel-cased here so nothing downstream sees the wire shape.
 */
export interface TokenSet {
  accessToken: string
  refreshToken: string
  /** Seconds until `accessToken` expires (Freesound issues 86400). */
  expiresIn: number
  scope: string
  tokenType: string
}

/** The signed-in user's profile, from `GET /apiv2/me/`. Only the username is used. */
export interface FreesoundProfile {
  username: string
}

export interface DownloadOriginalOptions {
  /** Aborted by the download queue when the user moves past the Sound. */
  signal?: AbortSignal
}

/** `contentType` is advisory only — the on-disk extension comes from the Sound's `type`. */
export interface DownloadOriginalResult {
  bytes: Uint8Array
  contentType: string | null
}

/**
 * The network boundary. Every call the app makes to Freesound goes through
 * this interface and nowhere else; unimplemented members throw `NotImplemented`.
 */
export interface FreesoundGateway {
  /**
   * `GET /apiv2/search/text/`. The app bundles no API key, so search
   * is an authenticated call like any other and MUST go through the core's
   * `authorized()` wrapper. There is no signed-out search path.
   */
  search(
    params: GatewaySearchParams,
    accessToken: string,
  ): Promise<RawSearchPage>

  /** Stream a Sound's Preview for auditioning. */
  getPreviewStream(soundId: number): Promise<never>

  /**
   * `GET /apiv2/sounds/<id>/download/` as the signed-in user. MUST go through
   * the core's `authorized()` wrapper. Streams the body; `opts.signal` aborts
   * mid-stream, rejecting with an `AbortError`.
   */
  downloadOriginal(
    soundId: number,
    accessToken: string,
    opts?: DownloadOriginalOptions,
  ): Promise<DownloadOriginalResult>

  /**
   * `POST ${workerUrl}/exchange` — the app never holds `client_secret`. Maps the
   * Worker's `{ error: "reauthorize" }` to `ReauthRequiredError` and
   * `{ error: "retry" }` to `RetryableTokenError`.
   */
  exchangeToken(code: string, redirectUri: string): Promise<TokenSet>

  /** `POST ${workerUrl}/refresh`. Same error mapping as `exchangeToken`. */
  refreshToken(refreshToken: string): Promise<TokenSet>

  /**
   * `GET /apiv2/me/`, for the username shown in the app. A 401 is thrown as a
   * `GatewayError` with `status: 401` so the auth wrapper refreshes and retries.
   */
  getMe(accessToken: string): Promise<FreesoundProfile>
}
