import type { Kanso } from '@kanso/core'
import type { PageSection } from '@kanso/shared'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { site } from './routes.tsx'
import { prepareSections } from './sections.tsx'
import { defaultTheme } from './themes/default/index.ts'

const heroSection: PageSection = {
  id: 'hero1',
  type: 'hero',
  settings: { heading: 'Welcome', button_label: 'Read more', button_url: '/about' },
}

function testKanso(overrides: Record<string, unknown> = {}): Kanso {
  return Object.assign(Object.create(null), {
    media: { find: vi.fn().mockResolvedValue(null) },
    postTypes: { findBySlug: vi.fn().mockResolvedValue(undefined) },
    posts: { listPublished: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
    ...overrides,
  })
}

describe('prepareSections', () => {
  it('keeps valid sections, applying field defaults', async () => {
    const prepared = await prepareSections(testKanso(), defaultTheme, [heroSection])
    expect(prepared).toHaveLength(1)
    expect(prepared[0]?.values).toMatchObject({ heading: 'Welcome', text: '', image: null })
  })

  it('skips unknown types and invalid settings without failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prepared = await prepareSections(testKanso(), defaultTheme, [
      { id: 'a', type: 'does_not_exist', settings: {} },
      { id: 'b', type: 'hero', settings: { heading: 42 } },
      heroSection,
    ])
    expect(prepared.map((section) => section.id)).toEqual(['hero1'])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('resolves image and posts fields ahead of rendering', async () => {
    const kanso = testKanso({
      media: { find: vi.fn().mockResolvedValue({ url: '/media/a.jpg', alt: 'Alt text' }) },
      postTypes: { findBySlug: vi.fn().mockResolvedValue({ id: 3, slug: 'blog', name: 'Blog' }) },
      posts: {
        listPublished: vi.fn().mockResolvedValue({
          items: [
            {
              id: 11,
              title: 'First post',
              slug: 'first-post',
              excerpt: 'Summary',
              publishedAt: new Date('2026-11-01T00:00:00Z'),
            },
          ],
          total: 1,
        }),
      },
    })
    const prepared = await prepareSections(kanso, defaultTheme, [
      { id: 'h', type: 'hero', settings: { heading: 'Hi', image: 7 } },
      {
        id: 'p',
        type: 'post_list',
        settings: { heading: 'News', source: { postTypeSlug: 'blog', limit: 2 } },
      },
    ])
    expect(prepared[0]?.data.images.image).toEqual({ url: '/media/a.jpg', alt: 'Alt text' })
    expect(kanso.posts.listPublished).toHaveBeenCalledWith({ postTypeId: 3, page: 1, perPage: 2 })
    expect(prepared[1]?.data.posts.source).toMatchObject({
      typeSlug: 'blog',
      typeName: 'Blog',
      items: [{ title: 'First post', href: '/blog/first-post' }],
    })
  })
})

describe('sections page rendering', () => {
  const sectionsPage = {
    id: 5,
    slug: 'landing',
    path: 'landing',
    parentId: null,
    sortOrder: 0,
    title: 'Landing',
    bodyJson: null,
    bodyHtml: '<p>Hidden body.</p>',
    sectionsJson: [
      heroSection,
      {
        id: 'cta1',
        type: 'cta',
        settings: { heading: 'Get started', button_label: 'Go', button_url: '/go' },
      },
    ],
    excerpt: null,
    status: 'published' as const,
    publishedAt: new Date('2026-11-01T00:00:00Z'),
    seoTitle: null,
    seoDescription: null,
    noindex: false,
    canonicalUrl: null,
    ogMediaId: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  }

  function testApp() {
    const kanso: Kanso = Object.assign(Object.create(null), {
      settings: {
        site: vi.fn().mockResolvedValue({
          title: 'Test site',
          description: '',
          locale: 'en',
          timezone: 'UTC',
          logoMediaId: null,
          homePostTypeSlug: null,
          theme: 'default',
        }),
        organization: vi.fn().mockResolvedValue({ name: '', url: null, logoUrl: null, sameAs: [] }),
      },
      pages: {
        listPublishedTopLevel: vi.fn().mockResolvedValue([]),
        findPublishedByPath: vi
          .fn()
          .mockImplementation((path: string) =>
            Promise.resolve(path === sectionsPage.path ? sectionsPage : undefined),
          ),
      },
      postTypes: { list: vi.fn().mockResolvedValue([]), findBySlug: vi.fn() },
      redirects: { findByPath: vi.fn().mockResolvedValue(null) },
      media: { find: vi.fn().mockResolvedValue(null) },
      posts: { listPublished: vi.fn() },
    })
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('kanso', kanso)
        await next()
      })
      .onError(onError)
      .route('/', site)
    const env = { SITE_URL: 'https://example.com', caches: undefined } as unknown as Bindings
    return { app, env }
  }

  it('renders sections instead of the rich text body', async () => {
    const { app, env } = testApp()
    const res = await app.request('/landing', {}, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('class="page-sections"')
    expect(html).toContain('<h1>Welcome</h1>')
    expect(html).toContain('Get started')
    expect(html).toContain('href="/go"')
    expect(html).not.toContain('Hidden body.')
    expect(html).not.toContain('<article class="page">')
  })
})
