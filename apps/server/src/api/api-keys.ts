import { zValidator } from '@hono/zod-validator'
import { createApiKeySchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { requireRole } from '../middleware/auth.ts'
import { logActivity } from './activity.ts'
import { idParamSchema, validationHook } from './validate.ts'

export const apiKeys = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => c.json({ items: await c.var.kanso.auth.listApiKeys() }))
  .post('/', zValidator('json', createApiKeySchema, validationHook), async (c) => {
    const { key, ...item } = await c.var.kanso.auth.createApiKey(c.req.valid('json'))
    await logActivity(c, {
      action: 'create',
      targetType: 'api_key',
      targetId: item.id,
      summary: `API キー「${item.name}」を作成`,
    })
    return c.json({ item, key }, 201)
  })
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.auth.deleteApiKey(id)
    await logActivity(c, {
      action: 'delete',
      targetType: 'api_key',
      targetId: id,
      summary: `API キー #${id} を削除`,
    })
    return c.json({ ok: true })
  })
