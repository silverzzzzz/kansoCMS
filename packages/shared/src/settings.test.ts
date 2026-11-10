import { describe, expect, it } from 'vitest'
import {
  organizationSettingsSchema,
  SETTINGS_KEYS,
  siteSettingsSchema,
  themeSettingsSchema,
} from './settings.ts'

describe('site settings', () => {
  it('defaults site-wide noindex to off', () => {
    expect(siteSettingsSchema.parse({}).noindex).toBe(false)
    expect(siteSettingsSchema.parse({ noindex: true }).noindex).toBe(true)
  })

  it('defaults the head/body extras to empty', () => {
    const site = siteSettingsSchema.parse({})
    expect(site.faviconMediaId).toBeNull()
    expect(site.googleSiteVerification).toBe('')
    expect(site.headHtml).toBeNull()
    expect(site.bodyEndHtml).toBeNull()
  })

  it('caps custom head/body HTML at 16KB', () => {
    const oversized = 'x'.repeat(16_001)
    expect(siteSettingsSchema.safeParse({ headHtml: oversized }).success).toBe(false)
    expect(siteSettingsSchema.safeParse({ bodyEndHtml: oversized }).success).toBe(false)
    expect(siteSettingsSchema.safeParse({ headHtml: 'x'.repeat(16_000) }).success).toBe(true)
  })
})

describe('theme settings', () => {
  it('keeps independent settings for arbitrary theme names', () => {
    const value = {
      default: { title: 'Default', logo: null },
      paper: { title: 'Paper', visible: false },
      custom: { nested: { color: 'blue' }, links: ['/', '/about'] },
    }

    expect(SETTINGS_KEYS.theme).toBe('theme')
    expect(themeSettingsSchema.parse({})).toEqual({})
    expect(themeSettingsSchema.parse(value)).toEqual(value)
  })

  it.each([null, [], 'paper', { paper: null }, { paper: [] }, { paper: 'title' }])(
    'rejects values without the two record levels: %j',
    (value) => {
      expect(themeSettingsSchema.safeParse(value).success).toBe(false)
    },
  )
})

describe('organization settings', () => {
  it('stores the X handle without the leading @', () => {
    expect(organizationSettingsSchema.parse({ twitterHandle: '@kansocms' }).twitterHandle).toBe(
      'kansocms',
    )
    expect(organizationSettingsSchema.parse({ twitterHandle: 'kansocms' }).twitterHandle).toBe(
      'kansocms',
    )
    expect(organizationSettingsSchema.parse({}).twitterHandle).toBe('')
  })

  it.each(['not a handle', 'toolonghandle123456', 'bad-hyphen'])(
    'rejects invalid X handles: %s',
    (twitterHandle) => {
      expect(organizationSettingsSchema.safeParse({ twitterHandle }).success).toBe(false)
    },
  )
})
