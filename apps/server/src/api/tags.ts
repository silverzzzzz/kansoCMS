import { zValidator } from '@hono/zod-validator'
import { createTagSchema, updateTagSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { logActivity } from './activity.ts'
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
    await logActivity(c, {
      action: 'create',
      targetType: 'tag',
      targetId: item.id,
      summary: `タグ「${item.name}」を作成`,
    })
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
      await logActivity(c, {
        action: 'update',
        targetType: 'tag',
        targetId: item.id,
        summary: `タグ「${item.name}」を更新`,
      })
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.taxonomies.deleteTag(id)
    await logActivity(c, {
      action: 'delete',
      targetType: 'tag',
      targetId: id,
      summary: `タグ #${id} を削除`,
    })
    return c.json({ ok: true })
  })
