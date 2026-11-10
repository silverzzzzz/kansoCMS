import { zValidator } from '@hono/zod-validator'
import { createMenuSchema, updateMenuSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { logActivity } from './activity.ts'
import { idParamSchema, validationHook } from './validate.ts'

export const menus = new Hono<AppEnv>()
  .get('/', async (c) => {
    return c.json({ items: await c.var.kanso.menus.list() })
  })
  .post('/', zValidator('json', createMenuSchema, validationHook), async (c) => {
    const item = await c.var.kanso.menus.create(c.req.valid('json'))
    await logActivity(c, {
      action: 'create',
      targetType: 'menu',
      targetId: item.id,
      summary: `メニュー「${item.name}」を作成`,
    })
    return c.json({ item }, 201)
  })
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: await c.var.kanso.menus.get(c.req.valid('param').id) })
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updateMenuSchema, validationHook),
    async (c) => {
      const item = await c.var.kanso.menus.update(c.req.valid('param').id, c.req.valid('json'))
      await logActivity(c, {
        action: 'update',
        targetType: 'menu',
        targetId: item.id,
        summary: `メニュー「${item.name}」を更新`,
      })
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.menus.delete(id)
    await logActivity(c, {
      action: 'delete',
      targetType: 'menu',
      targetId: id,
      summary: `メニュー #${id} を削除`,
    })
    return c.json({ ok: true })
  })
