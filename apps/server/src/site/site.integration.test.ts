import { SETTINGS_KEYS, sectionFieldListSchema, siteSettingsSchema } from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetPageviewTimezone } from '../middleware/pageviews.ts'
import { createTestApp, type TestApp } from '../testing.ts'

const context = { allowRawHtml: false }

function paragraph(text: string) {
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
  }
}

describe('public site over a real database', () => {
  let test: TestApp

  beforeEach(() => {
    resetPageviewTimezone()
    test = createTestApp()
  })
  afterEach(() => test.close())

  async function newsType() {
    return test.kanso.postTypes.create({ slug: 'news', name: 'News' })
  }

  describe('author archive', () => {
    it('exists only where the author has published posts', async () => {
      const author = await test.signIn({ name: 'Hana' })
      test.signOut()
      const news = await newsType()
      await test.kanso.postTypes.create({ slug: 'blog', name: 'Blog' })
      await test.kanso.posts.create(
        { postTypeId: news.id, slug: 'hello', title: 'Hello', status: 'published' },
        { ...context, authorId: author.id },
      )

      const withPosts = await test.request(`/news/author/${author.slug}`)
      const withoutPosts = await test.request(`/blog/author/${author.slug}`)

      expect(withPosts.status).toBe(200)
      expect(await withPosts.text()).toContain('Hello')
      expect(withoutPosts.status).toBe(404)
    })

    it('ignores drafts and trashed posts', async () => {
      const author = await test.signIn()
      test.signOut()
      const news = await newsType()
      await test.kanso.posts.create(
        { postTypeId: news.id, slug: 'draft', title: 'Draft', status: 'draft' },
        { ...context, authorId: author.id },
      )
      const trashed = await test.kanso.posts.create(
        { postTypeId: news.id, slug: 'gone', title: 'Gone', status: 'published' },
        { ...context, authorId: author.id },
      )
      await test.kanso.posts.delete(trashed.id)

      expect((await test.request(`/news/author/${author.slug}`)).status).toBe(404)
    })
  })

  describe('maintenance mode', () => {
    it('shows its own default message, not the 404 text', async () => {
      await test.kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, { maintenance: true })

      const response = await test.request('/')
      const html = await response.text()

      expect(response.status).toBe(503)
      expect(html).toContain('ただいまメンテナンス中です')
      expect(html).not.toContain('お探しのページは見つかりませんでした')
    })

    it('prefers the configured message and lets signed-in staff through', async () => {
      await test.kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, {
        maintenance: true,
        maintenanceMessage: '12 時に再開します',
      })

      expect(await (await test.request('/')).text()).toContain('12 時に再開します')
      await test.signIn()
      expect((await test.request('/')).status).toBe(200)
    })
  })

  describe('feed', () => {
    it('lists posts newest first even when an older post is pinned', async () => {
      const news = await newsType()
      const create = (slug: string, publishedAt: string, pinned = false) =>
        test.kanso.posts.create(
          { postTypeId: news.id, slug, title: slug, status: 'published', publishedAt, pinned },
          { ...context, authorId: null },
        )
      await create('old-pinned', '2020-01-01T00:00:00.000Z', true)
      await create('recent', '2026-01-01T00:00:00.000Z')

      const feed = await (await test.request('/news/feed.xml')).text()
      const archive = await (await test.request('/news')).text()

      expect(feed.indexOf('/news/recent')).toBeLessThan(feed.indexOf('/news/old-pinned'))
      // The archive page keeps the pinned post on top.
      expect(archive.indexOf('/news/old-pinned')).toBeLessThan(archive.indexOf('/news/recent'))
    })
  })

  describe('custom fields', () => {
    it('never renders a stored value that fails its definition', async () => {
      const type = await test.kanso.postTypes.create({
        slug: 'events',
        name: 'Events',
        // The API parses definitions with the shared schema (which fills defaults).
        fields: sectionFieldListSchema.parse([
          { type: 'text', name: 'venue', label: '会場' },
          { type: 'text', name: 'link', label: 'リンク' },
          { type: 'checkbox', name: 'online', label: 'オンライン' },
        ]),
      })
      const post = await test.kanso.posts.create(
        {
          postTypeId: type.id,
          slug: 'meetup',
          title: 'Meetup',
          status: 'published',
          bodyJson: paragraph('body'),
          fields: { venue: 'Tokyo', link: 'javascript:alert(1)', online: true },
        },
        { ...context, authorId: null },
      )
      // The definition changes afterwards: `link` becomes a URL field.
      await test.kanso.postTypes.update(type.id, {
        fields: sectionFieldListSchema.parse([
          { type: 'text', name: 'venue', label: '会場' },
          { type: 'url', name: 'link', label: 'リンク' },
          { type: 'checkbox', name: 'online', label: 'オンライン' },
        ]),
      })

      const html = await (await test.request(`/events/${post.slug}`)).text()

      expect(html).toContain('Tokyo')
      expect(html).toContain('<dd>あり</dd>')
      expect(html).not.toContain('javascript:')
    })

    it('labels a checked checkbox in the site language', async () => {
      await test.kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, { locale: 'en' })
      const type = await test.kanso.postTypes.create({
        slug: 'events',
        name: 'Events',
        fields: sectionFieldListSchema.parse([
          { type: 'checkbox', name: 'online', label: 'Online' },
        ]),
      })
      await test.kanso.posts.create(
        {
          postTypeId: type.id,
          slug: 'meetup',
          title: 'Meetup',
          status: 'published',
          fields: { online: true },
        },
        { ...context, authorId: null },
      )

      const html = await (await test.request('/events/meetup')).text()
      expect(html).toContain('<dd>Yes</dd>')
    })
  })
})

describe('share link URL', () => {
  async function issue(test: TestApp, origin?: string) {
    await test.signIn()
    const page = await test.kanso.pages.create(
      { title: 'Draft', slug: 'draft', status: 'draft' },
      context,
    )
    const response = await test.request(`${origin ?? ''}/api/v1/pages/${page.id}/share-links`, {
      method: 'POST',
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { item: { url: string } }
    return new URL(body.item.url)
  }

  it('uses SITE_URL in production', async () => {
    const test = createTestApp()
    expect((await issue(test)).origin).toBe('https://example.com')
    test.close()
  })

  it('uses the request origin while SITE_URL is a localhost placeholder', async () => {
    const test = createTestApp({ SITE_URL: 'http://localhost:5173' })
    const url = await issue(test, 'http://localhost:5199')
    expect(url.origin).toBe('http://localhost:5199')

    test.signOut()
    const shared = await test.request(`http://localhost:5199${url.pathname}`)
    expect(shared.status).toBe(200)
    expect(shared.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    test.close()
  })
})
