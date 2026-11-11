import { type MediaVariantWidth, mediaVariantWidths, supportsMediaVariants } from '@kanso/shared'
import { api } from '../api/client.ts'
import { unwrap } from '../api/request.ts'

/**
 * Responsive image variants are made here, in the browser that uploads the
 * file, and stored in R2 next to the original — no image service involved.
 * WebP wherever the browser can encode it; JPEG for JPEG originals otherwise
 * (a PNG may be transparent, so it gets no JPEG fallback).
 */

type VariantSource = { id: number; mime: string; width: number | null }
type Encoded = { width: MediaVariantWidth; blob: Blob }

const QUALITY = 0.82

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY))
}

/**
 * Scale `source` down to `width`. Halving in steps first keeps fine detail
 * from turning into jagged edges, which a single large reduction can do.
 */
function downscale(
  source: CanvasImageSource,
  from: { width: number; height: number },
  width: number,
) {
  let current: CanvasImageSource = source
  let size = from
  while (size.width / 2 > width) {
    const half = { width: Math.round(size.width / 2), height: Math.round(size.height / 2) }
    const step = canvasOf(half.width, half.height)
    step.context.drawImage(current, 0, 0, half.width, half.height)
    current = step.canvas
    size = half
  }
  const height = Math.max(1, Math.round((from.height * width) / from.width))
  const target = canvasOf(width, height)
  target.context.drawImage(current, 0, 0, width, height)
  return target.canvas
}

async function encode(canvas: HTMLCanvasElement, sourceType: string): Promise<Blob | null> {
  const webp = await toBlob(canvas, 'image/webp')
  // A browser that cannot encode WebP silently hands back a PNG.
  if (webp?.type === 'image/webp') return webp
  if (sourceType === 'image/jpeg') {
    const jpeg = await toBlob(canvas, 'image/jpeg')
    if (jpeg?.type === 'image/jpeg') return jpeg
  }
  return null
}

/** The variants worth making for `file`: only widths smaller than the picture itself. */
export async function createImageVariants(file: Blob, sourceType: string): Promise<Encoded[]> {
  if (!supportsMediaVariants(sourceType)) return []
  // Decoding applies the EXIF orientation, so a portrait photo is portrait here.
  const bitmap = await createImageBitmap(file)
  try {
    const variants: Encoded[] = []
    for (const width of mediaVariantWidths(bitmap.width)) {
      const blob = await encode(downscale(bitmap, bitmap, width), sourceType)
      if (blob) variants.push({ width, blob })
    }
    return variants
  } finally {
    bitmap.close()
  }
}

/**
 * Make the variants of an uploaded image and store them. Returns the updated
 * media item, or null when the image needs none (too small, or not a format
 * that gets variants).
 */
export async function uploadImageVariants(item: VariantSource, file: Blob) {
  if (!supportsMediaVariants(item.mime) || !item.width) return null
  const variants = await createImageVariants(file, item.mime)
  if (variants.length === 0) return null
  const form: { w480?: File; w960?: File; w1600?: File } = {}
  for (const variant of variants) {
    form[`w${variant.width}`] = new File([variant.blob], `w${variant.width}`, {
      type: variant.blob.type,
    })
  }
  const data = await unwrap(
    api.media[':id'].variants.$put({ param: { id: String(item.id) }, form }),
  )
  return data.item
}

/** The same for an image that is already in the library: its original is fetched first. */
export async function backfillImageVariants(item: VariantSource & { url: string }) {
  const response = await fetch(item.url)
  if (!response.ok) throw new Error(`Could not load ${item.url}`)
  return uploadImageVariants(item, await response.blob())
}

/** Whether an item is an image that could have variants but has none yet. */
export function needsImageVariants(item: {
  mime: string
  width: number | null
  variants: unknown[]
}): boolean {
  return (
    supportsMediaVariants(item.mime) &&
    item.variants.length === 0 &&
    mediaVariantWidths(item.width).length > 0
  )
}
