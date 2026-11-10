import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { validationHook } from './validate.ts'

export const analytics = new Hono<AppEnv>().get(
  '/summary',
  zValidator(
    'query',
    z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
    validationHook,
  ),
  async (c) => {
    const { timezone } = await c.var.kanso.settings.site()
    return c.json(await c.var.kanso.analytics.summary(c.req.valid('query').days, timezone))
  },
)
