import type { R2Bucket } from '@cloudflare/workers-types'
import {
  MEDIA_EXTENSIONS,
  MEDIA_MAX_BYTES,
  MEDIA_VARIANT_MAX_BYTES,
  MEDIA_VARIANT_TYPES,
  type MediaListQuery,
  type MediaVariant,
  type MediaVariantType,
  mediaUrl,
  mediaVariantKey,
  mediaVariantWidths,
  supportsMediaVariants,
} from '@kanso/shared'
import { count, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { media } from '../db/schema/index.ts'
import { contains } from '../db/search.ts'
import { KansoError } from '../errors.ts'
import { readImageSize } from '../storage/image-size.ts'
import { mediaObjectKey } from '../storage/keys.ts'
import { sniffMime } from '../storage/sniff.ts'

type UploadInput = {
  bytes: ArrayBuffer
  filename: string
  alt: string | null
}

type VariantUpload = { width: number; bytes: ArrayBuffer }

/** `in (...)` lists stay under D1's 100 bound parameters per query. */
const KEYS_PER_QUERY = 90

/** A media row as the rest of the app sees it: with its URL and the URLs of its variants. */
function withUrl<T extends { r2Key: string; variantsJson: MediaVariant[] | null }>(item: T) {
  const { variantsJson, ...rest } = item
  return {
    ...rest,
    url: mediaUrl(item.r2Key),
    variants: (variantsJson ?? []).map((variant) => ({
      width: variant.width,
      height: variant.height,
      url: mediaUrl(variant.r2Key),
    })),
  }
}

/** The render-ready view of a media row: URL, alt, dimensions and variants. */
export function toSiteImage(row: {
  r2Key: string
  alt: string | null
  width: number | null
  height: number | null
  variantsJson: MediaVariant[] | null
}) {
  return {
    url: mediaUrl(row.r2Key),
    alt: row.alt,
    width: row.width,
    height: row.height,
    variants: (row.variantsJson ?? []).map((variant) => ({
      width: variant.width,
      height: variant.height,
      url: mediaUrl(variant.r2Key),
    })),
  }
}

function isVariantType(mime: string | null): mime is MediaVariantType {
  return (MEDIA_VARIANT_TYPES as readonly string[]).includes(mime ?? '')
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
    const where = query.q ? contains(media.filename, query.q) : undefined
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

  /** Media rows for a set of R2 keys — used to make the images of a rendered body responsive. */
  async function findByKeys(keys: string[]) {
    const unique = [...new Set(keys)]
    const rows = []
    for (let offset = 0; offset < unique.length; offset += KEYS_PER_QUERY) {
      rows.push(
        ...(await db.query.media.findMany({
          where: inArray(media.r2Key, unique.slice(offset, offset + KEYS_PER_QUERY)),
        })),
      )
    }
    return rows.map(withUrl)
  }

  /**
   * Store the downscaled copies of an image and record them on its row,
   * replacing any earlier set. They are produced by the uploading browser
   * and only checked here: the right format, the declared width, and the
   * proportions of the original.
   */
  async function setVariants(id: number, uploads: VariantUpload[]) {
    const item = await db.query.media.findFirst({ where: eq(media.id, id) })
    if (!item) throw KansoError.notFound('Media')
    if (!supportsMediaVariants(item.mime) || !item.width || !item.height) {
      throw KansoError.validation('This file cannot have image variants')
    }
    const original = { width: item.width, height: item.height }
    // Rows stored before EXIF orientation was read hold the unrotated size of
    // a rotated photo, so a variant may legitimately be the quarter-turned shape.
    const turned = { width: item.height, height: item.width }
    const fits = (shape: typeof original, width: number, height: number) => {
      const expected = shape.height * (width / shape.width)
      return (
        mediaVariantWidths(shape.width).some((candidate) => candidate === width) &&
        Math.abs(height - expected) <= Math.max(2, expected * 0.02)
      )
    }
    const seen = new Set<number>()
    const prepared = uploads.map((upload) => {
      if (seen.has(upload.width)) {
        throw KansoError.validation(`Variant width ${upload.width} was sent twice`)
      }
      seen.add(upload.width)
      if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > MEDIA_VARIANT_MAX_BYTES) {
        throw KansoError.validation('Variant is empty or too large')
      }
      const bytes = new Uint8Array(upload.bytes)
      const mime = sniffMime(bytes)
      if (!isVariantType(mime)) throw KansoError.validation('Variants must be WebP or JPEG')
      const size = readImageSize(bytes, mime)
      if (!size || size.width !== upload.width) {
        throw KansoError.validation(`Variant is not ${upload.width} pixels wide`)
      }
      // Same picture, just smaller: an allowed width, and the original's proportions.
      if (!fits(original, size.width, size.height) && !fits(turned, size.width, size.height)) {
        throw KansoError.validation(
          `A ${size.width}x${size.height} variant does not fit a ${original.width}x${original.height} original`,
        )
      }
      return {
        bytes: upload.bytes,
        mime,
        variant: {
          width: size.width,
          height: size.height,
          r2Key: mediaVariantKey(item.r2Key, upload.width, mime),
          size: upload.bytes.byteLength,
        } satisfies MediaVariant,
      }
    })

    for (const entry of prepared) {
      await bucket.put(entry.variant.r2Key, entry.bytes, {
        httpMetadata: { contentType: entry.mime },
      })
    }
    const variants = prepared.map((entry) => entry.variant).sort((a, b) => a.width - b.width)
    // Objects of an earlier set that the new one does not overwrite.
    const kept = new Set(variants.map((variant) => variant.r2Key))
    const stale = (item.variantsJson ?? [])
      .map((variant) => variant.r2Key)
      .filter((key) => !kept.has(key))
    const updated = await db
      .update(media)
      .set({ variantsJson: variants })
      .where(eq(media.id, id))
      .returning({ id: media.id })
    if (updated.length === 0) {
      // The image was deleted while its variants were on their way: nothing
      // points at them, so they must not stay in the bucket.
      await bucket.delete([...kept]).catch(() => undefined)
      throw KansoError.notFound('Media')
    }
    if (stale.length > 0) await bucket.delete(stale).catch(() => undefined)
    return get(id)
  }

  async function updateAlt(id: number, alt: string | null) {
    await get(id)
    await db.update(media).set({ alt }).where(eq(media.id, id))
    return get(id)
  }

  async function deleteMedia(id: number): Promise<void> {
    const item = await db.query.media.findFirst({ where: eq(media.id, id) })
    if (!item) throw KansoError.notFound('Media')
    await bucket.delete([item.r2Key, ...(item.variantsJson ?? []).map((variant) => variant.r2Key)])
    await db.delete(media).where(eq(media.id, id))
  }

  return { find, findByKeys, list, get, upload, setVariants, updateAlt, delete: deleteMedia }
}

export type MediaService = ReturnType<typeof mediaService>
