import { zValidator } from '@hono/zod-validator'
import { createRedirectSchema, redirectImportSchema, updateRedirectSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { logActivity } from './activity.ts'
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
    await logActivity(c, {
      action: 'create',
      targetType: 'redirect',
      targetId: item.id,
      summary: `リダイレクト ${item.fromPath} を作成`,
    })
    return c.json({ item }, 201)
  })
  .post('/import', zValidator('json', redirectImportSchema, validationHook), async (c) => {
    const result = await c.var.kanso.redirects.importRows(c.req.valid('json').csv)
    await logActivity(c, {
      action: 'import',
      targetType: 'redirect',
      summary: `リダイレクトを CSV インポート (新規 ${result.created}・更新 ${result.updated} 件)`,
    })
    return c.json(result)
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updateRedirectSchema, validationHook),
    async (c) => {
      const item = await c.var.kanso.redirects.update(c.req.valid('param').id, c.req.valid('json'))
      await logActivity(c, {
        action: 'update',
        targetType: 'redirect',
        targetId: item.id,
        summary: `リダイレクト ${item.fromPath} を更新`,
      })
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.redirects.delete(id)
    await logActivity(c, {
      action: 'delete',
      targetType: 'redirect',
      targetId: id,
      summary: `リダイレクト #${id} を削除`,
    })
    return c.json({ ok: true })
  })
