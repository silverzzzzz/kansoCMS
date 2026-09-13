import { describe, expect, it } from 'vitest'
import { pagePurgePaths, postPurgePaths, postTypePurgePaths } from './paths.ts'

describe('purge path builders', () => {
  it('builds page paths and treats home specially', () => {
    expect(pagePurgePaths({ path: 'company' })).toEqual(['/', '/sitemap.xml', '/company'])
    expect(pagePurgePaths({ path: 'home' })).toEqual(['/', '/sitemap.xml'])
  })

  it('builds post detail, archive, feed and term paths', () => {
    expect(
      postPurgePaths({
        typeSlug: 'blog',
        slug: 'hello',
        categorySlugs: ['news'],
        tagSlugs: ['first'],
      }),
    ).toEqual([
      '/blog/hello',
      '/blog',
      '/blog/feed.xml',
      '/',
      '/sitemap.xml',
      '/blog/category/news',
      '/blog/tag/first',
    ])
  })

  it('builds post type paths', () => {
    expect(postTypePurgePaths('blog')).toEqual(['/blog', '/blog/feed.xml', '/', '/sitemap.xml'])
  })
})
