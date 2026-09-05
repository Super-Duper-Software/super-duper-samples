import { BrowserWindow } from 'electron'
import type { EventChannel } from '../shared/channels'

/** Push one core event to every open window. */
export function broadcast(channel: EventChannel, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** A `broadcast` bound to one channel, shaped as a core `on*` callback. */
export function broadcaster<T>(channel: EventChannel): (payload: T) => void {
  return (payload) => broadcast(channel, payload)
}
