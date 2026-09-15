import { cacheSettingsSchema, SETTINGS_KEYS } from '@kanso/shared'
import type { Db } from '../db/client.ts'
import { settingsService } from './settings.ts'

export function cacheVersionService(db: Db) {
  const settings = settingsService(db)

  /** Current generation; `'0'` until the first write. */
  async function get(): Promise<string> {
    return (await settings.get(SETTINGS_KEYS.cache, cacheSettingsSchema)).version
  }

  /** Rotate the generation with a fresh random token (single upsert, no read). */
  async function bump(): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const version = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    await settings.set(SETTINGS_KEYS.cache, cacheSettingsSchema, { version })
    return version
  }

  return { get, bump }
}
