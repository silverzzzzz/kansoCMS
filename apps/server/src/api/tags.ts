import { zValidator } from '@hono/zod-validator'
import { createTagSchema, updateTagSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { idParamSchema, validationHook } from './validate.ts'

const tagListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
})

export const tags = new Hono<AppEnv>()
  .get('/', zValidator('query', tagListQuerySchema, validationHook), async (c) => {
    return c.json({ items: await c.var.kanso.taxonomies.listTags(c.req.valid('query').q) })
  })
  .post('/', zValidator('json', createTagSchema, validationHook), async (c) => {
    const item = await c.var.kanso.taxonomies.createTag(c.req.valid('json'))
    return c.json({ item }, 201)
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updateTagSchema, validationHook),
    async (c) => {
      const item = await c.var.kanso.taxonomies.updateTag(
        c.req.valid('param').id,
        c.req.valid('json'),
      )
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    await c.var.kanso.taxonomies.deleteTag(c.req.valid('param').id)
    return c.json({ ok: true })
  })
