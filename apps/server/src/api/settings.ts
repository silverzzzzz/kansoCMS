import { zValidator } from '@hono/zod-validator'
import {
  formsSettingsSchema,
  organizationSettingsSchema,
  SETTINGS_KEYS,
  siteSettingsSchema,
  themeSettingsSchema,
} from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { requireRole } from '../middleware/auth.ts'
import { secret } from '../secrets.ts'
import { validationHook } from './validate.ts'

export const settings = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => {
    const [site, organization, forms] = await Promise.all([
      c.var.kanso.settings.site(),
      c.var.kanso.settings.organization(),
      c.var.kanso.settings.forms(),
    ])
    return c.json({
      site,
      organization,
      forms,
      turnstileSecretConfigured: secret(c.env, 'TURNSTILE_SECRET_KEY') !== undefined,
    })
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
  .put('/forms', zValidator('json', formsSettingsSchema, validationHook), async (c) => {
    const forms = await c.var.kanso.settings.set(
      SETTINGS_KEYS.forms,
      formsSettingsSchema,
      c.req.valid('json'),
    )
    return c.json({ forms })
  })
  .get('/theme', async (c) => {
    return c.json({ theme: await c.var.kanso.settings.theme() })
  })
  /**
   * Theme settings, namespaced by theme name so switching themes keeps the
   * other theme's values. Field-level validation against the theme's declared
   * settings fields arrives with T28.
   */
  .put('/theme', zValidator('json', themeSettingsSchema, validationHook), async (c) => {
    const theme = await c.var.kanso.settings.updateTheme(c.req.valid('json'))
    return c.json({ theme })
  })
