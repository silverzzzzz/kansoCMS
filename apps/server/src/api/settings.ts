import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import {
  formsSettingsSchema,
  organizationSettingsSchema,
  SETTINGS_KEYS,
  sectionValuesSchemaFor,
  siteSettingsSchema,
  themeNameSchema,
  themeSettingsSchema,
} from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { requireRole } from '../middleware/auth.ts'
import { secret } from '../secrets.ts'
import { themeSettingsFieldsByTheme } from '../site/themes/sections-meta.ts'
import { logActivity } from './activity.ts'
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
    await logActivity(c, {
      action: 'update',
      targetType: 'settings',
      targetId: SETTINGS_KEYS.site,
      summary: 'サイト設定を更新',
    })
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
      await logActivity(c, {
        action: 'update',
        targetType: 'settings',
        targetId: SETTINGS_KEYS.organization,
        summary: '組織設定を更新',
      })
      return c.json({ organization })
    },
  )
  .put('/forms', zValidator('json', formsSettingsSchema, validationHook), async (c) => {
    const forms = await c.var.kanso.settings.set(
      SETTINGS_KEYS.forms,
      formsSettingsSchema,
      c.req.valid('json'),
    )
    await logActivity(c, {
      action: 'update',
      targetType: 'settings',
      targetId: SETTINGS_KEYS.forms,
      summary: 'フォーム設定を更新',
    })
    return c.json({ forms })
  })
  .get('/theme', async (c) => {
    return c.json({ theme: await c.var.kanso.settings.theme() })
  })
  /**
   * Theme settings, namespaced by theme name so switching themes keeps the
   * other theme's values. Each namespace is validated against that theme's
   * declared settings fields; unknown theme names are rejected.
   */
  .put('/theme', zValidator('json', themeSettingsSchema, validationHook), async (c) => {
    const input = c.req.valid('json')
    const details: { path: string; message: string }[] = []
    for (const [name, values] of Object.entries(input)) {
      const parsedName = themeNameSchema.safeParse(name)
      if (!parsedName.success) {
        details.push({ path: name, message: `Unknown theme "${name}"` })
        continue
      }
      const schema = sectionValuesSchemaFor(themeSettingsFieldsByTheme[parsedName.data])
      const parsed = schema.safeParse(values)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          details.push({
            path: [name, ...issue.path.map(String)].join('.'),
            message: issue.message,
          })
        }
      }
    }
    if (details.length > 0) throw KansoError.validation('Invalid theme settings', details)
    const theme = await c.var.kanso.settings.updateTheme(input)
    await logActivity(c, {
      action: 'update',
      targetType: 'settings',
      targetId: 'theme',
      summary: 'テーマ設定を更新',
    })
    return c.json({ theme })
  })
