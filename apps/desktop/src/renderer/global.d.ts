import type { CoreApi } from '../preload'

declare global {
  interface Window {
    /** The contextBridge surface exposed by src/preload. */
    core: CoreApi
  }
}

export {}
