import { describe, expect, it } from 'vitest'
import { buildBlogPosting, buildCollectionPage, type SiteContext } from './jsonld.ts'

const site: SiteContext = { url: 'https://example.com', name: 'Example', locale: 'en' }

describe('JSON-LD builders', () => {
  it('builds a collection page linked to the website', () => {
    const value = buildCollectionPage(site, {
      url: 'https://example.com/blog',
      title: 'Blog',
    })

    expect(value['@type']).toBe('CollectionPage')
    expect(value.isPartOf).toEqual({ '@id': 'https://example.com/#website' })
  })

  it('builds a blog posting with image and keywords', () => {
    const value = buildBlogPosting(site, {
      url: 'https://example.com/blog/hello',
      title: 'Hello',
      imageUrl: 'https://example.com/media/cover.jpg',
      tags: ['first', 'second'],
    })

    expect(value.image).toBe('https://example.com/media/cover.jpg')
    expect(value.keywords).toBe('first, second')
  })
})
