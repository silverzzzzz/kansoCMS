import { absoluteUrl, buildAtomFeed, buildSitemap } from '@kanso/seo'
import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'

type PostType = Awaited<ReturnType<AppEnv['Variables']['kanso']['postTypes']['get']>>

export async function sitemapResponse(c: Context<AppEnv>) {
  const [pages, postTypes, posts] = await Promise.all([
    c.var.kanso.pages.listPublishedForSitemap(),
    c.var.kanso.postTypes.list(),
    c.var.kanso.posts.listPublishedForSitemap(),
  ])
  const typeSlugs = new Map(postTypes.map((type) => [type.id, type.slug]))
  const urls = [
    { loc: absoluteUrl(c.env.SITE_URL, '/') },
    ...pages
      .filter((page) => page.path !== 'home')
      .map((page) => ({
        loc: absoluteUrl(c.env.SITE_URL, `/${page.path}`),
        lastmod: page.updatedAt,
      })),
    ...postTypes.map((type) => ({ loc: absoluteUrl(c.env.SITE_URL, `/${type.slug}`) })),
    ...posts.flatMap((post) => {
      const typeSlug = typeSlugs.get(post.postTypeId)
      return typeSlug
        ? [
            {
              loc: absoluteUrl(c.env.SITE_URL, `/${typeSlug}/${post.slug}`),
              lastmod: post.updatedAt,
            },
          ]
        : []
    }),
  ]
  return c.body(buildSitemap(urls), 200, { 'content-type': 'application/xml; charset=utf-8' })
}

export function robotsResponse(c: Context<AppEnv>) {
  const body = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api',
    'Disallow: /preview',
    '',
    `Sitemap: ${absoluteUrl(c.env.SITE_URL, '/sitemap.xml')}`,
  ].join('\n')
  return c.body(body, 200, { 'content-type': 'text/plain; charset=utf-8' })
}

export async function feedResponse(c: Context<AppEnv>, type: PostType) {
  const [settings, result] = await Promise.all([
    c.var.kanso.settings.site(),
    c.var.kanso.posts.listPublished({ postTypeId: type.id, page: 1, perPage: 20 }),
  ])
  const feedUrl = absoluteUrl(c.env.SITE_URL, `/${type.slug}/feed.xml`)
  const body = buildAtomFeed({
    title: `${type.name} | ${settings.title}`,
    subtitle: type.description,
    siteUrl: c.env.SITE_URL,
    feedUrl,
    updated: result.items[0]?.updatedAt ?? null,
    entries: result.items.flatMap((post) =>
      post.publishedAt
        ? [
            {
              url: absoluteUrl(c.env.SITE_URL, `/${type.slug}/${post.slug}`),
              title: post.title,
              summary: post.excerpt,
              publishedAt: post.publishedAt,
              updatedAt: post.updatedAt,
            },
          ]
        : [],
    ),
  })
  return c.body(body, 200, { 'content-type': 'application/atom+xml; charset=utf-8' })
}
