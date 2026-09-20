import { zValidator } from '@hono/zod-validator'
import { createRedirectSchema, updateRedirectSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { idParamSchema, validationHook } from './validate.ts'

const redirectListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
})

export const redirects = new Hono<AppEnv>()
  .get('/', zValidator('query', redirectListQuerySchema, validationHook), async (c) => {
    return c.json({ items: await c.var.kanso.redirects.list(c.req.valid('query').q) })
  })
  .post('/', zValidator('json', createRedirectSchema, validationHook), async (c) => {
    const item = await c.var.kanso.redirects.create(c.req.valid('json'))
    return c.json({ item }, 201)
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updateRedirectSchema, validationHook),
    async (c) => {
      const item = await c.var.kanso.redirects.update(c.req.valid('param').id, c.req.valid('json'))
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    await c.var.kanso.redirects.delete(c.req.valid('param').id)
    return c.json({ ok: true })
  })
