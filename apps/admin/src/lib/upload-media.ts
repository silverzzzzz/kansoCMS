import { MEDIA_MAX_BYTES, MEDIA_MIME_TYPES } from '@kanso/shared'
import { api } from '../api/client.ts'
import { unwrap } from '../api/request.ts'
import { uploadImageVariants } from './image-variants.ts'

export function mediaFileError(file: File): string | null {
  if (file.size > MEDIA_MAX_BYTES) return '20 MB を超えています'
  if (!(MEDIA_MIME_TYPES as readonly string[]).includes(file.type)) return '対応していない形式です'
  return null
}

export async function uploadMediaFile(file: File) {
  const { item } = await unwrap(api.media.$post({ form: { file } }))
  // The original is available even if the optional responsive copies fail.
  return (await uploadImageVariants(item, file).catch(() => null)) ?? item
}
