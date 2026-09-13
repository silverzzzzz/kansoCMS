import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAtomFeed } from './feed.ts'

afterEach(() => vi.useRealTimers())

describe('buildAtomFeed', () => {
  it('builds an empty feed with self and alternate links', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T00:00:00.000Z'))
    const xml = buildAtomFeed({
      title: 'News',
      siteUrl: 'https://example.com',
      feedUrl: 'https://example.com/news/feed.xml',
      updated: null,
      entries: [],
    })

    expect(xml).toContain('<link rel="self" href="https://example.com/news/feed.xml"/>')
    expect(xml).toContain('<link rel="alternate" href="https://example.com"/>')
    expect(xml).toContain('<updated>2026-09-11T00:00:00.000Z</updated>')
    expect(xml).not.toContain('<entry>')
  })

  it('escapes entry titles', () => {
    const date = new Date('2026-09-11T00:00:00.000Z')
    const xml = buildAtomFeed({
      title: 'News',
      siteUrl: 'https://example.com',
      feedUrl: 'https://example.com/news/feed.xml',
      updated: date,
      entries: [
        {
          url: 'https://example.com/news/one',
          title: 'One < Two',
          publishedAt: date,
          updatedAt: date,
        },
      ],
    })

    expect(xml).toContain('<title>One &lt; Two</title>')
  })
})
