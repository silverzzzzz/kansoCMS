import type { Kanso, StarterInstallPlan } from '@kanso/core'
import type { SiteSettings, StarterManifest } from '@kanso/shared'
import { describe, expect, it, vi } from 'vitest'
import { STARTER_IMAGES, type StarterMedia } from './content.ts'
import { installStarter, starterBuild } from './install.ts'

const site: SiteSettings = {
  title: 'Example Shop',
  description: '',
  locale: 'ja',
  timezone: 'Asia/Tokyo',
  logoMediaId: null,
  ogImageMediaId: null,
  homePostTypeSlug: null,
  noindex: false,
  faviconMediaId: null,
  googleSiteVerification: '',
  headHtml: null,
  bodyEndHtml: null,
  robotsExtra: null,
  notFoundPageId: null,
  maintenance: false,
  maintenanceMessage: '',
  theme: 'paper',
}

const media = Object.fromEntries(
  STARTER_IMAGES.map((image, index) => [
    image.name,
    { id: index + 1, url: `/media/${image.name}` },
  ]),
) as StarterMedia

const manifest: StarterManifest = {
  installedAt: '2026-11-08T03:00:00.000Z',
  pages: [1, 2, 3, 4],
  posts: [5, 6, 7],
  postTypes: [8],
  categories: [9, 10],
  tags: [],
  forms: [11],
  media: [1, 2, 3, 4, 5, 6, 7],
  themeSettings: null,
  siteDescription: null,
}

const now = new Date('2026-11-08T03:00:00.000Z')

describe('starterBuild', () => {
  it('validates the content and targets the active theme settings', () => {
    const build = starterBuild(site, media, now)
    expect(build.form).toMatchObject({ slug: 'contact', turnstile: false, redirectUrl: null })
    expect(build.postType).toMatchObject({ slug: 'news', hasTags: false })
    expect(build.categories.map((category) => category.key)).toEqual(['info', 'event'])
    expect(build.posts.map((post) => post.categoryKey)).toEqual(['info', 'event', 'info'])
    expect(build.posts[0]?.input).not.toHaveProperty('postTypeId')
    expect(build.pages.map((page) => page.slug)).toEqual(['contact', 'about', 'services', 'home'])
    expect(build.themeSettings).toMatchObject({
      theme: 'paper',
      values: { accent: '#2f6f5e', sns_url_1: '' },
    })
    expect(build.siteDescription).toContain('Example Shop')
  })
})

describe('installStarter', () => {
  it('loads every bundled image and hands a validated build to the core install', async () => {
    const install = vi.fn(async (plan: StarterInstallPlan) => {
      plan.build(media)
      return { manifest, skipped: [{ kind: 'page' as const, slug: 'about' }] }
    })
    const kanso = Object.assign(Object.create(null), {
      settings: { site: vi.fn().mockResolvedValue(site) },
      starter: { install },
    }) as Kanso
    const loadImage = vi.fn(async () => new ArrayBuffer(4))

    const result = await installStarter(kanso, { userId: 3, loadImage, now })

    expect(loadImage).toHaveBeenCalledTimes(STARTER_IMAGES.length)
    const plan = install.mock.calls[0]?.[0]
    expect(plan?.authorId).toBe(3)
    expect(plan?.now).toBe(now)
    expect(plan?.images.map((image) => image.name)).toEqual(
      STARTER_IMAGES.map((image) => image.name),
    )
    expect(plan?.images[0]).toMatchObject({ alt: STARTER_IMAGES[0].alt })
    expect(result).toEqual({
      created: { pages: 4, posts: 3, postTypes: 1, categories: 2, tags: 0, forms: 1, media: 7 },
      skipped: [{ kind: 'page', slug: 'about' }],
    })
  })

  it('does not reach the core install when an image is missing', async () => {
    const install = vi.fn()
    const kanso = Object.assign(Object.create(null), {
      settings: { site: vi.fn().mockResolvedValue(site) },
      starter: { install },
    }) as Kanso
    const loadImage = vi.fn(async () => {
      throw new Error('Starter image hero.webp is not available (HTTP 404)')
    })
    await expect(installStarter(kanso, { userId: 3, loadImage, now })).rejects.toThrow('hero.webp')
    expect(install).not.toHaveBeenCalled()
  })
})
