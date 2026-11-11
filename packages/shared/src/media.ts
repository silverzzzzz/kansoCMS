import { z } from 'zod'
import { listQuerySchema } from './query.ts'

export const MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
] as const
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number]

export const MEDIA_MAX_BYTES = 20 * 1024 * 1024

export const MEDIA_EXTENSIONS: Record<MediaMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
}

export const updateMediaSchema = z.object({
  alt: z.string().trim().max(500).nullable(),
})

export const mediaListQuerySchema = listQuerySchema.pick({ page: true, perPage: true, q: true })
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>

export function mediaUrl(r2Key: string): string {
  return `/${r2Key}`
}

/**
 * Responsive images. Next to an original, R2 holds downscaled copies
 * ("variants") at these widths, made by the browser that uploads the file —
 * so nothing but R2 is needed to serve the right size, on any plan and in
 * local development alike. Only widths smaller than the original are made.
 */
export const MEDIA_VARIANT_WIDTHS = [480, 960, 1600] as const
export type MediaVariantWidth = (typeof MEDIA_VARIANT_WIDTHS)[number]
export const MEDIA_VARIANT_MAX_BYTES = 4 * 1024 * 1024

/**
 * Originals that get variants. GIF would lose its animation, AVIF has no
 * recorded dimensions to check a variant against, PDF is not an image.
 */
export const MEDIA_VARIANT_SOURCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** WebP wherever the browser can encode it; JPEG is the fallback for JPEG originals. */
export const MEDIA_VARIANT_TYPES = ['image/webp', 'image/jpeg'] as const
export type MediaVariantType = (typeof MEDIA_VARIANT_TYPES)[number]

/** One stored variant, as kept in `media.variants_json`. */
export type MediaVariant = {
  width: number
  height: number
  r2Key: string
  size: number
}

export function supportsMediaVariants(mime: string): boolean {
  return (MEDIA_VARIANT_SOURCE_TYPES as readonly string[]).includes(mime)
}

/** Variant widths worth making for an original of `width` pixels. */
export function mediaVariantWidths(width: number | null | undefined): MediaVariantWidth[] {
  if (!width) return []
  return MEDIA_VARIANT_WIDTHS.filter((candidate) => candidate < width)
}

/** `media/2026/11/<id>.jpg` + 960 → `media/2026/11/<id>.w960.webp`. */
export function mediaVariantKey(r2Key: string, width: number, type: MediaVariantType): string {
  const base = r2Key.replace(/\.[a-z0-9]+$/i, '')
  return `${base}.w${width}.${type === 'image/webp' ? 'webp' : 'jpg'}`
}

/** What a renderer needs to emit a responsive `<img>`. */
export type ResponsiveImage = {
  url: string
  width: number | null
  height: number | null
  variants: { width: number; height: number; url: string }[]
}

/**
 * `srcset` for an image with variants: every variant plus the original, each
 * with its width descriptor. Undefined when there is nothing to choose from.
 */
export function mediaSrcset(image: ResponsiveImage): string | undefined {
  if (image.variants.length === 0) return undefined
  const candidates = image.variants
    .map((variant) => ({ url: variant.url, width: variant.width }))
    .sort((a, b) => a.width - b.width)
  if (image.width) candidates.push({ url: image.url, width: image.width })
  return candidates.map((candidate) => `${candidate.url} ${candidate.width}w`).join(', ')
}

/**
 * The smallest variant at least `minWidth` wide — for places that show an
 * image small (admin thumbnails, avatars) or want a light copy of it.
 */
export function mediaVariantUrl(image: ResponsiveImage, minWidth: number): string {
  const fitting = image.variants
    .filter((variant) => variant.width >= minWidth)
    .sort((a, b) => a.width - b.width)[0]
  return fitting?.url ?? image.url
}
