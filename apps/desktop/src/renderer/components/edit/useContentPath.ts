import { useEffect, useState } from 'react'

/**
 * Absolute path to a Sound's Original: `undefined` while the lookup is in
 * flight, `null` when it is not on disk.
 */
export function useContentPath(soundId: number): string | null | undefined {
  const [path, setPath] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setPath(undefined)
    void window.core
      .getContentPath(soundId)
      .then((p) => {
        if (!cancelled) setPath(p)
      })
      .catch(() => {
        if (!cancelled) setPath(null)
      })
    return () => {
      cancelled = true
    }
  }, [soundId])

  return path
}
