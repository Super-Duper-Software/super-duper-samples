// FreesoundGateway is the SOLE network boundary of the core. Everything that
// crosses the network to Freesound or to the token Worker lives behind it, so
// tests can drive the core with a fake and never touch the network.

import type { SearchFilter, SearchSort } from '../types'

/**
 * The exact `fields` set requested from `/apiv2/search/text/`. One search call
 * returns everything a result row needs, so NO per-Sound detail request is ever
 * made. Keep in sync with `mapRawSound` and the `Sound` type.
 */
export const SEARCH_FIELDS =
  'id,name,username,license,duration,tags,filesize,type,samplerate,channels,bitdepth,previews,images,url,num_downloads,avg_rating,created'

export interface GatewaySearchParams {
  query: string
  /** 1-based page number. */
  page: number
  pageSize: number
  /**
   * ticket 15 — result ordering. Absent means Freesound's default relevance
   * (`score`). Translated to a `sort=` param by `freesoundSortParam`.
   */
  sort?: SearchSort
  /**
   * ticket 15 — structured pre-filter. Absent or all-empty means no constraint.
   * Translated to a Solr-style `filter=` string by `freesoundFilterString`.
   */
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
 * A normalized OAuth token set, as returned by the token Worker's `/exchange`
 * and `/refresh` (the Worker forwards Freesound's
 * `{ access_token, refresh_token, expires_in, scope, token_type }`). Field names
 * are camel-cased at this boundary so nothing downstream sees the wire shape.
 */
export interface TokenSet {
  accessToken: string
  refreshToken: string
  /** Seconds until `accessToken` expires (Freesound issues 24h == 86400). */
  expiresIn: number
  scope: string
  tokenType: string
}

/** The signed-in user's profile, from `GET /apiv2/me/`. Only the username is used. */
export interface FreesoundProfile {
  username: string
}

/** Options for `downloadOriginal` — cancellation only, for now. */
export interface DownloadOriginalOptions {
  /** Aborted by the download queue when the user moves past the Sound. */
  signal?: AbortSignal
}

/**
 * The result of downloading a Sound's Original: the complete file bytes plus the
 * `Content-Type` the server reported (advisory only — the on-disk extension comes
 * from the Sound's `type`).
 */
export interface DownloadOriginalResult {
  bytes: Uint8Array
  contentType: string | null
}

/**
 * The network boundary. `search` is the only method implemented for ticket 02;
 * the rest are declared so later tickets extend one interface, and throw
 * `NotImplemented` until then.
 */
export interface FreesoundGateway {
  search(params: GatewaySearchParams): Promise<RawSearchPage>

  /** ticket 04 — stream a Sound's Preview for auditioning. */
  getPreviewStream(soundId: number): Promise<never>

  /**
   * ticket 08 — download a Sound's Original as the signed-in user.
   * `GET https://freesound.org/apiv2/sounds/<id>/download/` with
   * `Authorization: Bearer <accessToken>`. This IS an authenticated call and MUST
   * be invoked through the core's `authorized()` wrapper so a 401 refreshes once
   * and retries once (ticket 07). Streams the response body; `opts.signal` aborts
   * it mid-stream, in which case the promise rejects with an `AbortError`.
   */
  downloadOriginal(
    soundId: number,
    accessToken: string,
    opts?: DownloadOriginalOptions,
  ): Promise<DownloadOriginalResult>

  /**
   * ticket 07 — exchange an OAuth authorization code for tokens, via the token
   * Worker (`POST ${workerUrl}/exchange`). The app never holds `client_secret`.
   * `redirectUri` is the single registered loopback URI and is forwarded to the
   * Worker. Maps the Worker's `{ error: "reauthorize" }` to `ReauthRequiredError`
   * and `{ error: "retry" }` to `RetryableTokenError`.
   */
  exchangeToken(code: string, redirectUri: string): Promise<TokenSet>

  /**
   * ticket 07 — refresh an expiring OAuth access token, via the token Worker
   * (`POST ${workerUrl}/refresh`). Same error mapping as `exchangeToken`.
   */
  refreshToken(refreshToken: string): Promise<TokenSet>

  /**
   * ticket 07 — fetch the signed-in user's profile straight from Freesound
   * (`GET /apiv2/me/`, `Authorization: Bearer <accessToken>`), for the username
   * shown in the app. A 401 here is thrown as a `GatewayError` with `status: 401`
   * so the core's auth wrapper triggers exactly one refresh + retry.
   */
  getMe(accessToken: string): Promise<FreesoundProfile>
}
