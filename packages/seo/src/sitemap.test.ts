import { describe, expect, it } from 'vitest'
import { buildSitemap } from './sitemap.ts'

describe('buildSitemap', () => {
  it('escapes URLs and includes lastmod when present', () => {
    const xml = buildSitemap([
      { loc: 'https://example.com/a?x=1&y=<two>' },
      { loc: 'https://example.com/b', lastmod: new Date('2026-09-11T00:00:00.000Z') },
    ])

    expect(xml).toContain('https://example.com/a?x=1&amp;y=&lt;two&gt;')
    expect(xml).toContain('<lastmod>2026-09-11T00:00:00.000Z</lastmod>')
    expect(xml.match(/<lastmod>/g)).toHaveLength(1)
  })
})
