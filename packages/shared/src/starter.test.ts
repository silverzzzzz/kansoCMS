import { describe, expect, it } from 'vitest'
import { SETTINGS_KEYS } from './settings.ts'
import { starterManifestSchema } from './starter.ts'

const manifest = {
  installedAt: '2026-11-08T00:00:00.000Z',
  pages: [1, 2],
  posts: [3],
  postTypes: [4],
  categories: [5, 6],
  tags: [],
  forms: [7],
  media: [8, 9],
  themeSettings: { theme: 'default', values: { accent: '#2f6f5e', footer_text: 'Sample' } },
  siteDescription: 'Sample description',
}

describe('starter manifest', () => {
  it('is stored under its own settings key', () => {
    expect(SETTINGS_KEYS.starter).toBe('starter')
  })

  it('accepts a complete manifest and nullable settings snapshots', () => {
    expect(starterManifestSchema.parse(manifest)).toEqual(manifest)
    expect(
      starterManifestSchema.parse({ ...manifest, themeSettings: null, siteDescription: null }),
    ).toMatchObject({ themeSettings: null, siteDescription: null })
  })

  it('rejects unknown themes, non-positive ids and malformed timestamps', () => {
    expect(
      starterManifestSchema.safeParse({
        ...manifest,
        themeSettings: { theme: 'nope', values: {} },
      }).success,
    ).toBe(false)
    expect(starterManifestSchema.safeParse({ ...manifest, pages: [0] }).success).toBe(false)
    expect(starterManifestSchema.safeParse({ ...manifest, installedAt: 'yesterday' }).success).toBe(
      false,
    )
  })
})
