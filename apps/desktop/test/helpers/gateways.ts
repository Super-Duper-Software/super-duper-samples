import type { FreesoundGateway } from '../../src/core/gateway/index'

/**
 * A gateway whose every method rejects — "no internet connection". Anything a
 * test does with one of these proves the behaviour is served from disk.
 */
export function deadGateway(): FreesoundGateway {
  const fail = (): Promise<never> =>
    Promise.reject(new Error('gateway unavailable (offline)'))
  return {
    search: fail,
    getPreviewStream: fail,
    downloadOriginal: fail,
    exchangeToken: fail,
    refreshToken: fail,
    getMe: fail,
  }
}
