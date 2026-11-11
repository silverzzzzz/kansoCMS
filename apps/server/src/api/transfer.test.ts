import { SETTINGS_KEYS, siteSettingsSchema } from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing.ts'

const header = { version: 1, exportedAt: '2026-12-01T00:00:00.000Z' }

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

describe('export / import API', () => {
  let test: TestApp

  beforeEach(() => {
    test = createTestApp()
  })
  afterEach(() => test.close())

  async function apiKey(scope: 'read' | 'write') {
    const created = await test.kanso.auth.createApiKey({ name: `${scope}-key`, scope })
    return { 'x-api-key': created.key }
  }

  describe('GET /export', () => {
    it('downloads the bundle as an attachment, without settings by default', async () => {
      await test.signIn()
      await test.kanso.pages.create(
        { title: 'About', slug: 'about', status: 'published' },
        { allowRawHtml: false },
      )

      const response = await test.request('/api/v1/export')
      const bundle = (await response.json()) as { pages: { path: string }[]; settings?: unknown }

      expect(response.status).toBe(200)
      expect(response.headers.get('content-disposition')).toMatch(
        /^attachment; filename="kanso-export-\d{4}-\d{2}-\d{2}\.json"$/,
      )
      expect(bundle.pages.map((page) => page.path)).toEqual(['about'])
      expect(bundle.settings).toBeUndefined()
    })

    it('requires the write scope even though it is a GET', async () => {
      test.signOut()
      expect((await test.request('/api/v1/export')).status).toBe(401)
      expect((await test.request('/api/v1/export', { headers: await apiKey('read') })).status).toBe(
        403,
      )
      expect(
        (await test.request('/api/v1/export', { headers: await apiKey('write') })).status,
      ).toBe(200)
    })

    it('hands settings to an administrator only', async () => {
      await test.kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, { title: 'My site' })

      const withKey = await test.request('/api/v1/export?settings=1', {
        headers: await apiKey('write'),
      })
      expect(withKey.status).toBe(403)

      await test.signIn({ role: 'editor' })
      expect((await test.request('/api/v1/export?settings=1')).status).toBe(403)

      test.signOut()
      await test.signIn({ role: 'admin' })
      const response = await test.request('/api/v1/export?settings=1')
      const bundle = (await response.json()) as { settings: Record<string, { title?: string }> }
      expect(bundle.settings.site?.title).toBe('My site')
    })
  })

  describe('POST /import', () => {
    it('imports content with a write key but never settings', async () => {
      const response = await test.request('/api/v1/import', {
        method: 'POST',
        headers: await apiKey('write'),
        json: {
          ...header,
          pages: [{ path: 'about', title: 'About', status: 'published', bodyJson: doc('Hello') }],
          settings: { site: { title: 'Taken over', headHtml: '<script>alert(1)</script>' } },
        },
      })
      const report = (await response.json()) as { created: number; warnings: string[] }

      expect(response.status).toBe(200)
      expect(report.created).toBe(1)
      expect(report.warnings.join('\n')).toMatch(/only an administrator/)
      const site = await test.kanso.settings.site()
      expect(site.headHtml).toBeNull()
      expect(await (await test.request('/about')).text()).not.toContain('alert(1)')
    })

    it('does not let an editor change settings either', async () => {
      await test.signIn({ role: 'editor' })
      await test.request('/api/v1/import', {
        method: 'POST',
        json: { ...header, settings: { site: { title: 'x', maintenance: true } } },
      })
      expect((await test.kanso.settings.site()).maintenance).toBe(false)
    })

    it('applies settings for an administrator and bumps the public cache', async () => {
      await test.signIn()
      const before = await test.kanso.cacheVersion.get()
      const response = await test.request('/api/v1/import', {
        method: 'POST',
        json: { ...header, settings: { site: { title: 'New title' } } },
      })

      expect(response.status).toBe(200)
      expect((await test.kanso.settings.site()).title).toBe('New title')
      expect(await test.kanso.cacheVersion.get()).not.toBe(before)
    })

    it('ignores a sample-content manifest, so removing samples cannot hit other rows', async () => {
      await test.signIn()
      const own = await test.kanso.pages.create(
        { title: 'Our own page', slug: 'own', status: 'published' },
        { allowRawHtml: false },
      )

      await test.request('/api/v1/import', {
        method: 'POST',
        json: {
          ...header,
          settings: {
            starter: {
              installedAt: '2026-11-12T00:00:00.000Z',
              pages: [own.id],
              posts: [],
              postTypes: [],
              categories: [],
              tags: [],
              forms: [],
              media: [],
              themeSettings: null,
              siteDescription: null,
            },
          },
        },
      })

      const status = (await (await test.request('/api/v1/starter')).json()) as {
        installed: boolean
      }
      expect(status.installed).toBe(false)
      expect((await test.request('/api/v1/starter', { method: 'DELETE' })).status).toBe(404)
      await expect(test.kanso.pages.get(own.id)).resolves.toMatchObject({ title: 'Our own page' })
    })

    it('rejects a request above the per-request limit and a wrong version', async () => {
      await test.signIn()
      const tooMany = await test.request('/api/v1/import', {
        method: 'POST',
        json: {
          ...header,
          posts: Array.from({ length: 101 }, (_, index) => ({
            postType: 'news',
            slug: `p-${index}`,
            title: 'x',
          })),
        },
      })
      const wrongVersion = await test.request('/api/v1/import', {
        method: 'POST',
        json: { ...header, version: 2 },
      })

      expect(tooMany.status).toBe(400)
      expect(wrongVersion.status).toBe(400)
    })

    it('rejects page paths that are not made of slugs', async () => {
      await test.signIn()
      const response = await test.request('/api/v1/import', {
        method: 'POST',
        json: { ...header, pages: [{ path: 'About Us/../x', title: 'x' }] },
      })
      expect(response.status).toBe(400)
    })

    it('keeps a full request inside the Workers Free budget of 50 queries', async () => {
      await test.signIn()
      const body = {
        ...header,
        postTypes: [{ slug: 'news', name: 'News' }],
        categories: [{ postType: 'news', slug: 'events', name: 'Events' }],
        tags: [{ slug: 'tokyo', name: 'Tokyo' }],
        pages: Array.from({ length: 100 }, (_, index) => ({
          path: `page-${index}`,
          title: `Page ${index}`,
          bodyJson: doc(`page ${index}`),
        })),
        posts: Array.from({ length: 100 }, (_, index) => ({
          postType: 'news',
          slug: `post-${index}`,
          title: `Post ${index}`,
          status: 'published',
          bodyJson: doc(`post ${index}`),
          categories: ['events'],
          tags: ['tokyo'],
        })),
      }

      test.resetQueries()
      const created = await test.request('/api/v1/import', { method: 'POST', json: body })
      const createQueries = test.queries()
      test.resetQueries()
      const repeated = await test.request('/api/v1/import', { method: 'POST', json: body })
      const repeatQueries = test.queries()

      expect(await created.json()).toMatchObject({ created: 203, warnings: [] })
      expect(await repeated.json()).toMatchObject({ created: 0, updated: 0, skipped: 203 })
      expect(createQueries).toBeLessThanOrEqual(40)
      expect(repeatQueries).toBeLessThanOrEqual(25)
    })

    it('attributes revisions of updated content to the importing user', async () => {
      const user = await test.signIn()
      const page = await test.kanso.pages.create(
        { title: 'Before', slug: 'about', status: 'draft' },
        { allowRawHtml: false },
      )
      await test.request('/api/v1/import', {
        method: 'POST',
        json: { ...header, pages: [{ path: 'about', title: 'After' }] },
      })

      const [revision] = await test.kanso.revisions.list('page', page.id)
      expect(revision).toMatchObject({ title: 'Before', user: { id: user.id } })
    })
  })
})
