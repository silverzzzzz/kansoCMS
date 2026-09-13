import { zValidator } from '@hono/zod-validator'
import { organizationSettingsSchema, SETTINGS_KEYS, siteSettingsSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { requireRole } from '../middleware/auth.ts'
import { validationHook } from './validate.ts'

export const settings = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => {
    const [site, organization] = await Promise.all([
      c.var.kanso.settings.site(),
      c.var.kanso.settings.organization(),
    ])
    return c.json({ site, organization })
  })
  .put('/site', zValidator('json', siteSettingsSchema, validationHook), async (c) => {
    const site = await c.var.kanso.settings.set(
      SETTINGS_KEYS.site,
      siteSettingsSchema,
      c.req.valid('json'),
    )
    return c.json({ site })
  })
  .put(
    '/organization',
    zValidator('json', organizationSettingsSchema, validationHook),
    async (c) => {
      const organization = await c.var.kanso.settings.set(
        SETTINGS_KEYS.organization,
        organizationSettingsSchema,
        c.req.valid('json'),
      )
      return c.json({ organization })
    },
  )
