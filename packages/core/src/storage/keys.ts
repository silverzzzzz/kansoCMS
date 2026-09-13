import { MEDIA_EXTENSIONS, type MediaMimeType } from '@kanso/shared'

export function mediaObjectKey(
  mime: MediaMimeType,
  now = new Date(),
  id = crypto.randomUUID(),
): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `media/${year}/${month}/${id}.${MEDIA_EXTENSIONS[mime]}`
}
