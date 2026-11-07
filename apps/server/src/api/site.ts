import { KansoError } from '@kanso/core'
import { themeNameSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { sectionsMetaByTheme, themeSettingsFieldsByTheme } from '../site/themes/sections-meta.ts'

/**
 * Read-only site metadata for the admin UI. /sections lists the section
 * catalog of the active theme (or ?theme=<name>): everything the customize
 * editor needs to render settings forms, without shipping zod schemas or
 * components to the client.
 */
export const siteInfo = new Hono<AppEnv>().get('/sections', async (c) => {
  const requested = c.req.query('theme')
  let name: keyof typeof sectionsMetaByTheme
  if (requested === undefined) {
    name = (await c.var.kanso.settings.site()).theme
  } else {
    const parsed = themeNameSchema.safeParse(requested)
    if (!parsed.success) throw KansoError.notFound('Theme')
    name = parsed.data
  }
  const items = Object.entries(sectionsMetaByTheme[name]).map(([type, meta]) => ({
    type,
    label: meta.label,
    description: meta.description ?? null,
    fields: meta.fields,
  }))
  return c.json({ theme: name, items, settings: themeSettingsFieldsByTheme[name] })
})
