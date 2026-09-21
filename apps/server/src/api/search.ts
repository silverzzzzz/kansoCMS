import { zValidator } from '@hono/zod-validator'
import { searchQuerySchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { validationHook } from './validate.ts'

export const search = new Hono<AppEnv>()
  .get('/', zValidator('query', searchQuerySchema, validationHook), async (c) => {
    return c.json(await c.var.kanso.search.search(c.req.valid('query')))
  })
  .post('/reindex', async (c) => {
    return c.json({ ok: true, ...(await c.var.kanso.search.reindex()) })
  })
