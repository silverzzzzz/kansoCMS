import { zValidator } from '@hono/zod-validator'
import { createPageSchema, listQuerySchema, updatePageSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { purgeSiteCache } from '../middleware/cache.ts'
import { pagePurgePaths } from '../site/paths.ts'
import { canUseRawHtml } from './principal.ts'
import { idParamSchema, validationHook } from './validate.ts'

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
    purgeSiteCache(c, pagePurgePaths(item))
    return c.json({ item }, 201)
  })
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: await c.var.kanso.pages.get(c.req.valid('param').id) })
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updatePageSchema, validationHook),
    async (c) => {
      const id = c.req.valid('param').id
      const previous = await c.var.kanso.pages.get(id)
      const item = await c.var.kanso.pages.update(id, c.req.valid('json'), {
        allowRawHtml: canUseRawHtml(c.var.principal),
      })
      purgeSiteCache(c, [...pagePurgePaths(previous), ...pagePurgePaths(item)])
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    const previous = await c.var.kanso.pages.get(id)
    await c.var.kanso.pages.delete(id)
    purgeSiteCache(c, pagePurgePaths(previous))
    return c.json({ ok: true })
  })
