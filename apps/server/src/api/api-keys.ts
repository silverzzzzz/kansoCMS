import { zValidator } from '@hono/zod-validator'
import { createApiKeySchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { requireRole } from '../middleware/auth.ts'
import { idParamSchema, validationHook } from './validate.ts'

export const apiKeys = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => c.json({ items: await c.var.kanso.auth.listApiKeys() }))
  .post('/', zValidator('json', createApiKeySchema, validationHook), async (c) => {
    const { key, ...item } = await c.var.kanso.auth.createApiKey(c.req.valid('json'))
    return c.json({ item, key }, 201)
  })
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    await c.var.kanso.auth.deleteApiKey(c.req.valid('param').id)
    return c.json({ ok: true })
  })
