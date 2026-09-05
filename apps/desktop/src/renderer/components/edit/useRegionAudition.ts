import { useCallback, useEffect, useState } from 'react'
import * as editAudio from '../../store/editAudioController'
import { regionToSeconds, type Region } from '../../lib/regionGeometry'

export interface RegionAudition {
  playing: boolean
  /** Start or stop the loop. A no-op without both a region and a local Original. */
  toggle: () => void
  stop: () => void
}

/**
 * Loop-auditions the selected region from the local Original. The region is
 * pushed to the player as it changes, so dragging an edge while it loops
 * retargets the loop rather than restarting it.
 */
export function useRegionAudition(
  contentPath: string | null | undefined,
  durationSec: number,
  region: Region | null,
): RegionAudition {
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    editAudio.setCallbacks({ onEnded: () => setPlaying(false) })
    return () => {
      editAudio.stop()
      editAudio.setCallbacks({})
    }
  }, [])

  useEffect(() => {
    if (!playing || !region) return
    editAudio.setRegion(regionToSeconds(region, durationSec))
  }, [region, playing, durationSec])

  const toggle = useCallback(() => {
    if (!contentPath || !region) return
    if (playing) {
      editAudio.pause()
      setPlaying(false)
      return
    }
    editAudio.loadRegion(contentPath, regionToSeconds(region, durationSec))
    editAudio.play()
    setPlaying(true)
  }, [contentPath, region, playing, durationSec])

  const stop = useCallback(() => {
    if (!playing) return
    editAudio.pause()
    setPlaying(false)
  }, [playing])

  return { playing, toggle, stop }
}
