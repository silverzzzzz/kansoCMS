import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import {
  MEDIA_MAX_BYTES,
  MEDIA_VARIANT_MAX_BYTES,
  MEDIA_VARIANT_WIDTHS,
  mediaListQuerySchema,
  updateMediaSchema,
} from '@kanso/shared'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { logActivity } from './activity.ts'
import { idParamSchema, validationHook } from './validate.ts'

const uploadMediaSchema = z.object({
  file: z.instanceof(File),
  alt: z.string().trim().max(500).optional(),
})

/** Downscaled copies of one image, one optional file per variant width. */
const variantsFormSchema = z.object({
  w480: z.instanceof(File).optional(),
  w960: z.instanceof(File).optional(),
  w1600: z.instanceof(File).optional(),
})

// Multipart framing plus the `alt` field never needs more than this on top of the file.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/** Rejects oversized uploads from Content-Length before the body is buffered. */
const rejectOversizedBody = createMiddleware<AppEnv>(async (c, next) => {
  const length = Number(c.req.header('content-length'))
  if (Number.isFinite(length) && length > MEDIA_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw KansoError.validation('File is too large')
  }
  await next()
})

/** The same guard for a set of variants. */
const rejectOversizedVariants = createMiddleware<AppEnv>(async (c, next) => {
  const length = Number(c.req.header('content-length'))
  const limit = MEDIA_VARIANT_WIDTHS.length * MEDIA_VARIANT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES
  if (Number.isFinite(length) && length > limit) {
    throw KansoError.validation('Variants are too large')
  }
  await next()
})

export const media = new Hono<AppEnv>()
  .get('/', zValidator('query', mediaListQuerySchema, validationHook), async (c) => {
    const query = c.req.valid('query')
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const result = await c.var.kanso.media.list(query)
    return c.json({ ...result, page, perPage })
  })
  .post(
    '/',
    rejectOversizedBody,
    zValidator('form', uploadMediaSchema, validationHook),
    async (c) => {
      const input = c.req.valid('form')
      if (input.file.size > MEDIA_MAX_BYTES) {
        throw KansoError.validation('File is too large')
      }
      const item = await c.var.kanso.media.upload({
        bytes: await input.file.arrayBuffer(),
        filename: input.file.name,
        alt: input.alt ?? null,
      })
      await logActivity(c, {
        action: 'create',
        targetType: 'media',
        targetId: item.id,
        summary: `メディア「${item.filename}」をアップロード`,
      })
      return c.json({ item }, 201)
    },
  )
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: await c.var.kanso.media.get(c.req.valid('param').id) })
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updateMediaSchema, validationHook),
    async (c) => {
      const item = await c.var.kanso.media.updateAlt(
        c.req.valid('param').id,
        c.req.valid('json').alt,
      )
      await logActivity(c, {
        action: 'update',
        targetType: 'media',
        targetId: item.id,
        summary: `メディア「${item.filename}」を更新`,
      })
      return c.json({ item })
    },
  )
  /**
   * Store the downscaled copies of an image (made by the uploading browser)
   * next to the original in R2, replacing any earlier set.
   */
  .put(
    '/:id/variants',
    rejectOversizedVariants,
    zValidator('param', idParamSchema, validationHook),
    zValidator('form', variantsFormSchema, validationHook),
    async (c) => {
      const form = c.req.valid('form')
      const uploads = []
      for (const width of MEDIA_VARIANT_WIDTHS) {
        const file = form[`w${width}`]
        if (file) uploads.push({ width, bytes: await file.arrayBuffer() })
      }
      if (uploads.length === 0) throw KansoError.validation('No variants were sent')
      const item = await c.var.kanso.media.setVariants(c.req.valid('param').id, uploads)
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.media.delete(id)
    await logActivity(c, {
      action: 'delete',
      targetType: 'media',
      targetId: id,
      summary: `メディア #${id} を削除`,
    })
    return c.json({ ok: true })
  })
