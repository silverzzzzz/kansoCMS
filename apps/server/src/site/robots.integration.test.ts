import { SETTINGS_KEYS, siteSettingsSchema } from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing.ts'
import { AI_TRAINING_CRAWLERS } from './feeds.ts'

describe('robots.txt and AI training', () => {
  let test: TestApp

  beforeEach(() => {
    test = createTestApp()
  })

  afterEach(() => {
    test.close()
  })

  async function robots() {
    const response = await test.request('/robots.txt')
    expect(response.status).toBe(200)
    return response.text()
  }

  it('says nothing about AI training by default', async () => {
    const body = await robots()
    expect(body).not.toContain('Content-Signal')
    expect(body).not.toContain('GPTBot')
  })

  it('opts out of AI training without touching search', async () => {
    const site = await test.kanso.settings.site()
    await test.kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, {
      ...site,
      disallowAiTraining: true,
      robotsExtra: 'Disallow: /private/',
    })

    const body = await robots()
    expect(body).toBe(
      [
        'User-agent: *',
        'Content-Signal: search=yes, ai-train=no',
        'Disallow: /api',
        'Disallow: /preview',
        ...AI_TRAINING_CRAWLERS.flatMap((agent) => ['', `User-agent: ${agent}`, 'Disallow: /']),
        '',
        'Disallow: /private/',
        '',
        'Sitemap: https://example.com/sitemap.xml',
      ].join('\n'),
    )
    // Search crawlers stay in the `*` group, which still allows the site.
    expect(body).not.toMatch(/User-agent: (Googlebot|Bingbot)/)
  })
})
