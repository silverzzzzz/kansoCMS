import type { R2Bucket } from '@cloudflare/workers-types'
import { MEDIA_EXTENSIONS, MEDIA_MAX_BYTES, type MediaListQuery, mediaUrl } from '@kanso/shared'
import type { SQL } from 'drizzle-orm'
import { count, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { media } from '../db/schema/index.ts'
import { KansoError } from '../errors.ts'
import { readImageSize } from '../storage/image-size.ts'
import { mediaObjectKey } from '../storage/keys.ts'
import { sniffMime } from '../storage/sniff.ts'

type UploadInput = {
  bytes: ArrayBuffer
  filename: string
  alt: string | null
}

function searchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}

function searchFilename(query: string): SQL {
  return sql`${media.filename} like ${searchPattern(query)} escape ${'\\'}`
}

function withUrl<T extends { r2Key: string }>(item: T): T & { url: string } {
  return { ...item, url: mediaUrl(item.r2Key) }
}

function sanitizeFilename(filename: string, extension: string): string {
  const basename = filename.split(/[/\\]/).at(-1) ?? ''
  const cleaned = Array.from(basename)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x1f && codePoint !== 0x7f
    })
    .join('')
    .trim()
  return Array.from(cleaned || `upload.${extension}`)
    .slice(0, 200)
    .join('')
}

/**
 * Validate an upload and derive its storage key and row. Shared by `upload`
 * and the starter site's bulk insert; the caller puts the bytes into R2.
 */
export function prepareMediaObject(input: UploadInput) {
  if (input.bytes.byteLength > MEDIA_MAX_BYTES) {
    throw KansoError.validation('File is too large')
  }
  if (input.bytes.byteLength === 0) throw KansoError.validation('File is empty')

  const bytes = new Uint8Array(input.bytes)
  const mime = sniffMime(bytes)
  if (!mime) throw KansoError.validation('Unsupported file type')

  const dimensions = readImageSize(bytes, mime)
  const r2Key = mediaObjectKey(mime)
  return {
    r2Key,
    mime,
    values: {
      r2Key,
      filename: sanitizeFilename(input.filename, MEDIA_EXTENSIONS[mime]),
      mime,
      size: input.bytes.byteLength,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      alt: input.alt,
    } satisfies typeof media.$inferInsert,
  }
}

export async function assertMediaExists(db: Db, id: number | null | undefined): Promise<void> {
  if (id === null || id === undefined) return
  const item = await db.query.media.findFirst({ where: eq(media.id, id), columns: { id: true } })
  if (!item) throw KansoError.validation('Media does not exist')
}

export function mediaService(db: Db, bucket: R2Bucket) {
  async function find(id: number) {
    const item = await db.query.media.findFirst({ where: eq(media.id, id) })
    return item ? withUrl(item) : null
  }

  async function list(query: MediaListQuery) {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const where = query.q ? searchFilename(query.q) : undefined
    const [items, totals] = await Promise.all([
      db.query.media.findMany({
        where,
        orderBy: [desc(media.createdAt), desc(media.id)],
        limit: perPage,
        offset: (page - 1) * perPage,
      }),
      db.select({ value: count() }).from(media).where(where),
    ])
    return { items: items.map(withUrl), total: totals[0]?.value ?? 0 }
  }

  async function get(id: number) {
    const item = await db.query.media.findFirst({ where: eq(media.id, id) })
    if (!item) throw KansoError.notFound('Media')
    return withUrl(item)
  }

  async function upload(input: UploadInput) {
    const prepared = prepareMediaObject(input)
    await bucket.put(prepared.r2Key, input.bytes, { httpMetadata: { contentType: prepared.mime } })

    try {
      const [created] = await db.insert(media).values(prepared.values).returning()
      if (!created) throw new Error('Media insert did not return a row')
      return withUrl(created)
    } catch (error) {
      await bucket.delete(prepared.r2Key).catch(() => undefined)
      throw error
    }
  }

  async function updateAlt(id: number, alt: string | null) {
    await get(id)
    await db.update(media).set({ alt }).where(eq(media.id, id))
    return get(id)
  }

  async function deleteMedia(id: number): Promise<void> {
    const item = await get(id)
    await bucket.delete(item.r2Key)
    await db.delete(media).where(eq(media.id, id))
  }

  return { find, list, get, upload, updateAlt, delete: deleteMedia }
}

export type MediaService = ReturnType<typeof mediaService>
