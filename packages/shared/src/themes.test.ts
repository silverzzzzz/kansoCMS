import { describe, expect, it } from 'vitest'
import { siteSettingsSchema } from './settings.ts'
import { THEME_NAMES, THEMES } from './themes.ts'

describe('themes', () => {
  it('defaults existing site settings to the default theme', () => {
    expect(siteSettingsSchema.parse({}).theme).toBe('default')
  })

  it('rejects unknown theme names', () => {
    expect(siteSettingsSchema.safeParse({ theme: 'nope' }).success).toBe(false)
  })

  it.each(THEME_NAMES)('accepts and describes the %s theme', (theme) => {
    expect(siteSettingsSchema.parse({ theme }).theme).toBe(theme)
    expect(THEMES[theme].label).not.toBe('')
    expect(THEMES[theme].description).not.toBe('')
  })
})
