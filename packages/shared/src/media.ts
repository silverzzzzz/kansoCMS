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
