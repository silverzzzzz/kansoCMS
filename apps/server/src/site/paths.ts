export function pagePurgePaths(page: { path: string }): string[] {
  return page.path === 'home' ? ['/', '/sitemap.xml'] : ['/', '/sitemap.xml', `/${page.path}`]
}

export function postPurgePaths(post: {
  typeSlug: string
  slug: string
  categorySlugs: string[]
  tagSlugs: string[]
}): string[] {
  const base = `/${post.typeSlug}`
  return [
    `${base}/${post.slug}`,
    base,
    `${base}/feed.xml`,
    '/',
    '/sitemap.xml',
    ...post.categorySlugs.map((slug) => `${base}/category/${slug}`),
    ...post.tagSlugs.map((slug) => `${base}/tag/${slug}`),
  ]
}

export function postTypePurgePaths(slug: string): string[] {
  return [`/${slug}`, `/${slug}/feed.xml`, '/', '/sitemap.xml']
}
