import { describe, expect, it } from 'vitest'
import {
  exportBundleSchema,
  IMPORT_REQUEST_LIMITS,
  importBundleSchema,
  splitBundle,
} from './transfer.ts'

const header = { version: 1, exportedAt: '2026-11-12T00:00:00.000Z' }

describe('bundle schemas', () => {
  it('accepts page paths made of slugs only', () => {
    const parse = (path: string) =>
      importBundleSchema.safeParse({ ...header, pages: [{ path, title: 'x' }] }).success
    expect(parse('company/team')).toBe(true)
    expect(parse('home')).toBe(true)
    expect(parse('Company')).toBe(false)
    expect(parse('a//b')).toBe(false)
    expect(parse('a/../b')).toBe(false)
    expect(parse('/a')).toBe(false)
  })

  it('caps a single request but not a whole file', () => {
    const posts = Array.from({ length: IMPORT_REQUEST_LIMITS.posts + 1 }, (_, index) => ({
      postType: 'news',
      slug: `p-${index}`,
      title: 'x',
    }))
    expect(importBundleSchema.safeParse({ ...header, posts }).success).toBe(false)
    expect(exportBundleSchema.safeParse({ ...header, posts }).success).toBe(true)
  })

  it('carries form definitions', () => {
    const parsed = importBundleSchema.parse({
      ...header,
      forms: [
        { slug: 'contact', name: 'Contact', fields: [{ type: 'text', name: 'n', label: 'N' }] },
      ],
    })
    expect(parsed.forms[0]).toMatchObject({ notifyTo: '', turnstile: false, redirectUrl: null })
  })
})

describe('splitBundle', () => {
  it('returns one request for a small file', () => {
    const bundle = exportBundleSchema.parse({
      ...header,
      postTypes: [{ slug: 'news', name: 'News' }],
      pages: [{ path: 'about', title: 'About' }],
    })
    // Structure and pages are separate requests; an empty posts part is never sent.
    expect(splitBundle(bundle).map((part) => [part.postTypes.length, part.pages.length])).toEqual([
      [1, 0],
      [0, 1],
    ])
  })

  it('orders requests so that references always resolve', () => {
    const bundle = exportBundleSchema.parse({
      ...header,
      settings: { site: { title: 'x' } },
      postTypes: [{ slug: 'news', name: 'News' }],
      categories: [
        { postType: 'news', slug: 'child', name: 'Child', parent: 'parent' },
        { postType: 'news', slug: 'parent', name: 'Parent' },
      ],
      pages: [
        { path: 'a/b/c', title: 'C' },
        { path: 'a', title: 'A' },
        { path: 'a/b', title: 'B' },
      ],
      posts: Array.from({ length: 120 }, (_, index) => ({
        postType: 'news',
        slug: `p-${index}`,
        title: 'x',
      })),
    })

    const parts = splitBundle(bundle)

    expect(parts.map((part) => Object.keys(part.settings ?? {}).length)).toEqual([0, 0, 0, 0, 0, 1])
    expect(parts[0]?.categories.map((item) => item.slug)).toEqual(['parent', 'child'])
    expect(parts[1]?.pages.map((item) => item.path)).toEqual(['a', 'a/b', 'a/b/c'])
    expect(parts.slice(2, 5).map((part) => part.posts.length)).toEqual([50, 50, 20])
    for (const part of parts) expect(importBundleSchema.safeParse(part).success).toBe(true)
  })

  it('never sends the media list and survives an empty file', () => {
    const bundle = exportBundleSchema.parse({
      ...header,
      media: [{ key: 'media/a.webp', filename: 'a.webp', mime: 'image/webp', size: 1 }],
    })
    const parts = splitBundle(bundle)
    expect(parts).toHaveLength(1)
    expect(parts[0]?.media).toEqual([])
  })

  it('spreads oversized taxonomies over several structure requests', () => {
    const tags = Array.from({ length: IMPORT_REQUEST_LIMITS.tags + 10 }, (_, index) => ({
      slug: `t-${index}`,
      name: `T ${index}`,
    }))
    const parts = splitBundle(exportBundleSchema.parse({ ...header, tags }))
    expect(parts.map((part) => part.tags.length)).toEqual([IMPORT_REQUEST_LIMITS.tags, 10])
  })
})
