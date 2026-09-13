import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { MEDIA_MAX_BYTES, mediaListQuerySchema, updateMediaSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { idParamSchema, validationHook } from './validate.ts'

const uploadMediaSchema = z.object({
  file: z.instanceof(File),
  alt: z.string().trim().max(500).optional(),
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
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    await c.var.kanso.media.delete(c.req.valid('param').id)
    return c.json({ ok: true })
  })
