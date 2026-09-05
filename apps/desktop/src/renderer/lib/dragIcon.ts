const ICON_W = 128
const ICON_H = 48

export async function waveformIconDataUrl(
  imageUrl: string,
): Promise<string | undefined> {
  if (!imageUrl || typeof document === 'undefined') return undefined
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const ready = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('waveform image failed to load'))
    })
    img.src = imageUrl
    await ready

    const canvas = document.createElement('canvas')
    canvas.width = ICON_W
    canvas.height = ICON_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(img, 0, 0, ICON_W, ICON_H)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}
