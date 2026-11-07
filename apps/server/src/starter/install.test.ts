import { type Kanso, KansoError } from '@kanso/core'
import { SETTINGS_KEYS, type StarterManifest } from '@kanso/shared'
import { describe, expect, it, vi } from 'vitest'
import { installStarter } from './install.ts'

type Options = {
  existingPages?: string[]
  existingPostTypes?: string[]
  existingForms?: string[]
  themeSettings?: Record<string, Record<string, unknown>>
  description?: string
  manifest?: StarterManifest | null
  failOnPage?: string
}

function testKanso(options: Options = {}) {
  let nextId = 100
  const created = () => ({ id: nextId++ })
  const settings = {
    starter: vi.fn().mockResolvedValue(options.manifest ?? null),
    site: vi.fn().mockResolvedValue({
      title: 'Example Shop',
      description: options.description ?? '',
      locale: 'ja',
      timezone: 'Asia/Tokyo',
      logoMediaId: null,
      homePostTypeSlug: null,
      theme: 'default',
    }),
    theme: vi.fn().mockResolvedValue(options.themeSettings ?? {}),
    updateTheme: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  }
  const kanso = Object.assign(Object.create(null), {
    settings,
    media: {
      upload: vi.fn(async (input: { filename: string }) => ({
        ...created(),
        url: `/media/${input.filename}`,
      })),
    },
    forms: {
      create: vi.fn(async (input: { slug: string }) => {
        if (options.existingForms?.includes(input.slug)) {
          throw KansoError.conflict('Form slug already exists')
        }
        return created()
      }),
    },
    postTypes: {
      create: vi.fn(async (input: { slug: string }) => {
        if (options.existingPostTypes?.includes(input.slug)) {
          throw KansoError.conflict('Post type slug already exists')
        }
        return created()
      }),
    },
    taxonomies: { createCategory: vi.fn(async () => created()) },
    posts: { create: vi.fn(async () => created()) },
    pages: {
      create: vi.fn(async (input: { slug: string }) => {
        if (options.failOnPage === input.slug) throw new Error('D1 is unavailable')
        if (options.existingPages?.includes(input.slug)) {
          throw KansoError.conflict('Page path already exists')
        }
        return created()
      }),
    },
  }) as Kanso
  return { kanso, settings }
}

const loadImage = vi.fn(async () => new ArrayBuffer(8))
const now = new Date('2026-11-08T03:00:00.000Z')

function writtenManifest(settings: ReturnType<typeof testKanso>['settings']): StarterManifest {
  const call = settings.set.mock.calls.find(([key]) => key === SETTINGS_KEYS.starter)
  if (!call) throw new Error('Manifest was not written')
  return call[2] as StarterManifest
}

describe('installStarter', () => {
  it('creates the whole starter site on an empty site and records it', async () => {
    const { kanso, settings } = testKanso({ themeSettings: { paper: { footer_text: 'Paper' } } })
    const result = await installStarter(kanso, { userId: 1, loadImage, now })

    expect(result).toEqual({
      created: { pages: 4, posts: 3, postTypes: 1, categories: 2, tags: 0, forms: 1, media: 7 },
      skipped: [],
    })
    expect(kanso.posts.create).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [expect.any(Number)], status: 'published' }),
      { allowRawHtml: false, authorId: 1 },
    )
    expect(kanso.pages.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'home', sections: expect.any(Array) }),
      { allowRawHtml: false },
    )

    // Theme settings go into the active theme only; other namespaces are kept.
    expect(settings.updateTheme).toHaveBeenCalledWith({
      paper: { footer_text: 'Paper' },
      default: expect.objectContaining({ accent: '#2f6f5e' }),
    })
    expect(settings.set).toHaveBeenCalledWith(
      SETTINGS_KEYS.site,
      expect.anything(),
      expect.objectContaining({ description: expect.stringContaining('Example Shop') }),
    )

    const manifest = writtenManifest(settings)
    expect(manifest.installedAt).toBe(now.toISOString())
    expect(manifest.media).toHaveLength(7)
    expect(manifest.pages).toHaveLength(4)
    expect(manifest.themeSettings).toMatchObject({
      theme: 'default',
      values: { accent: '#2f6f5e' },
    })
    expect(manifest.siteDescription).toContain('Example Shop')
  })

  it('skips items whose slug or path is taken, and posts of a skipped post type', async () => {
    const { kanso, settings } = testKanso({
      existingPages: ['about'],
      existingPostTypes: ['news'],
      existingForms: ['contact'],
    })
    const result = await installStarter(kanso, { userId: null, loadImage, now })

    expect(result.skipped).toEqual([
      { kind: 'form', slug: 'contact' },
      { kind: 'postType', slug: 'news' },
      { kind: 'page', slug: 'about' },
    ])
    expect(kanso.taxonomies.createCategory).not.toHaveBeenCalled()
    expect(kanso.posts.create).not.toHaveBeenCalled()
    const manifest = writtenManifest(settings)
    expect(manifest.pages).toHaveLength(3)
    expect(manifest.forms).toEqual([])
    expect(manifest.postTypes).toEqual([])
    expect(manifest.posts).toEqual([])
  })

  it('leaves existing theme settings and site description alone', async () => {
    const { kanso, settings } = testKanso({
      themeSettings: { default: { accent: '#000000' } },
      description: 'Our own description',
    })
    await installStarter(kanso, { userId: 1, loadImage, now })

    expect(settings.updateTheme).not.toHaveBeenCalled()
    expect(settings.set).not.toHaveBeenCalledWith(
      SETTINGS_KEYS.site,
      expect.anything(),
      expect.anything(),
    )
    const manifest = writtenManifest(settings)
    expect(manifest.themeSettings).toBeNull()
    expect(manifest.siteDescription).toBeNull()
  })

  it('refuses to install twice', async () => {
    const { kanso } = testKanso({
      manifest: {
        installedAt: now.toISOString(),
        pages: [1],
        posts: [],
        postTypes: [],
        categories: [],
        tags: [],
        forms: [],
        media: [],
        themeSettings: null,
        siteDescription: null,
      },
    })
    await expect(installStarter(kanso, { userId: 1, loadImage, now })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(kanso.media.upload).not.toHaveBeenCalled()
  })

  it('records partial progress when a step fails', async () => {
    const { kanso, settings } = testKanso({ failOnPage: 'services' })
    await expect(installStarter(kanso, { userId: 1, loadImage, now })).rejects.toThrow(
      'D1 is unavailable',
    )

    const manifest = writtenManifest(settings)
    expect(manifest.media).toHaveLength(7)
    expect(manifest.posts).toHaveLength(3)
    // contact and about were created before services failed; home was never reached.
    expect(manifest.pages).toHaveLength(2)
    expect(manifest.themeSettings).toBeNull()
  })

  it('records nothing when it fails before creating anything', async () => {
    const { kanso, settings } = testKanso()
    const failingLoad = vi.fn(async () => {
      throw new Error('Asset missing')
    })
    await expect(installStarter(kanso, { userId: 1, loadImage: failingLoad, now })).rejects.toThrow(
      'Asset missing',
    )
    expect(settings.set).not.toHaveBeenCalled()
  })
})
