import { organizationSettingsSchema, SETTINGS_KEYS, siteSettingsSchema } from '@kanso/shared'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Db } from '../db/client.ts'
import { settings } from '../db/schema/index.ts'

export function settingsService(db: Db) {
  async function getRaw(key: string): Promise<unknown> {
    const row = await db.query.settings.findFirst({ where: eq(settings.key, key) })
    return row?.valueJson
  }

  /** Read a setting and coerce it through its schema (defaults fill gaps). */
  async function get<S extends z.ZodType>(key: string, schema: S): Promise<z.output<S>> {
    const raw = (await getRaw(key)) ?? {}
    return schema.parse(raw)
  }

  async function set<S extends z.ZodType>(key: string, schema: S, value: z.input<S>) {
    const parsed = schema.parse(value)
    await db
      .insert(settings)
      .values({ key, valueJson: parsed })
      .onConflictDoUpdate({ target: settings.key, set: { valueJson: parsed } })
    return parsed
  }

  return {
    get,
    set,
    site: () => get(SETTINGS_KEYS.site, siteSettingsSchema),
    organization: () => get(SETTINGS_KEYS.organization, organizationSettingsSchema),
  }
}

export type SettingsService = ReturnType<typeof settingsService>
