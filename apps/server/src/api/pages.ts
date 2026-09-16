import { zValidator } from '@hono/zod-validator'
import { createPageSchema, listQuerySchema, updatePageSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { canUseRawHtml, currentUserId } from './principal.ts'
import { idParamSchema, revisionParamSchema, validationHook } from './validate.ts'

export const pages = new Hono<AppEnv>()
  .get('/', zValidator('query', listQuerySchema, validationHook), async (c) => {
    const query = c.req.valid('query')
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const result = await c.var.kanso.pages.list(query)
    return c.json({ ...result, page, perPage })
  })
  .post('/', zValidator('json', createPageSchema, validationHook), async (c) => {
    const item = await c.var.kanso.pages.create(c.req.valid('json'), {
      allowRawHtml: canUseRawHtml(c.var.principal),
    })
    return c.json({ item }, 201)
  })
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: await c.var.kanso.pages.get(c.req.valid('param').id) })
  })
  .get('/:id/revisions', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.pages.get(id)
    return c.json({ items: await c.var.kanso.revisions.list('page', id) })
  })
  .get(
    '/:id/revisions/:revisionId',
    zValidator('param', revisionParamSchema, validationHook),
    async (c) => {
      const { id, revisionId } = c.req.valid('param')
      return c.json({ item: await c.var.kanso.revisions.get('page', id, revisionId) })
    },
  )
  .post(
    '/:id/revisions/:revisionId/restore',
    zValidator('param', revisionParamSchema, validationHook),
    async (c) => {
      const { id, revisionId } = c.req.valid('param')
      const item = await c.var.kanso.pages.restoreRevision(id, revisionId, {
        allowRawHtml: canUseRawHtml(c.var.principal),
        userId: currentUserId(c.var.principal),
      })
      return c.json({ item })
    },
  )
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updatePageSchema, validationHook),
    async (c) => {
      const id = c.req.valid('param').id
      const item = await c.var.kanso.pages.update(id, c.req.valid('json'), {
        allowRawHtml: canUseRawHtml(c.var.principal),
        userId: currentUserId(c.var.principal),
      })
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.pages.delete(id)
    return c.json({ ok: true })
  })
