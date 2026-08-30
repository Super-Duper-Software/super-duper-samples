// FreesoundGateway is the SOLE network boundary of the core. Everything that
// crosses the network to Freesound or to the token Worker lives behind it, so
// tests can drive the core with a fake and never touch the network.

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
 * The network boundary. `search` is the only method implemented for ticket 02;
 * the rest are declared so later tickets extend one interface, and throw
 * `NotImplemented` until then.
 */
export interface FreesoundGateway {
  search(params: GatewaySearchParams): Promise<RawSearchPage>

  /** ticket 04 — stream a Sound's Preview for auditioning. */
  getPreviewStream(soundId: number): Promise<never>

  /** ticket 08 — download a Sound's Original as the signed-in user. */
  downloadOriginal(soundId: number): Promise<never>

  /** ticket 06/07 — exchange an OAuth authorization code for tokens. */
  exchangeToken(code: string): Promise<never>

  /** ticket 06/07 — refresh an expiring OAuth access token. */
  refreshToken(refreshToken: string): Promise<never>
}
