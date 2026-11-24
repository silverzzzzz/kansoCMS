import { absoluteUrl, buildAtomFeed, buildSitemap } from '@kanso/seo'
import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'

type PostType = Awaited<ReturnType<AppEnv['Variables']['kanso']['postTypes']['get']>>

export async function sitemapResponse(c: Context<AppEnv>) {
  const [settings, home, pages, postTypes, posts, categories, tags, authors] = await Promise.all([
    c.var.kanso.settings.site(),
    c.var.kanso.pages.findPublishedByPath('home'),
    c.var.kanso.pages.listPublishedForSitemap(),
    c.var.kanso.postTypes.list(),
    c.var.kanso.posts.listPublishedForSitemap(),
    c.var.kanso.taxonomies.listCategoryArchivesForSitemap(),
    c.var.kanso.taxonomies.listTagArchivesForSitemap(),
    c.var.kanso.posts.listAuthorsForSitemap(),
  ])
  const xml = (urls: Parameters<typeof buildSitemap>[0]) =>
    c.body(buildSitemap(urls), 200, { 'content-type': 'application/xml; charset=utf-8' })
  // A site-wide noindex means nothing here is indexable; crawlers learn that from the pages.
  if (settings.noindex) return xml([])

  const typeSlugs = new Map(postTypes.map((type) => [type.id, type.slug]))
  const indexableTypes = postTypes.filter((type) => !type.noindex)
  const indexableTypeIds = new Set(indexableTypes.map((type) => type.id))
  const latestByType = new Map<number, Date>()
  for (const post of posts) {
    const current = latestByType.get(post.postTypeId)
    if (!current || post.updatedAt > current) latestByType.set(post.postTypeId, post.updatedAt)
  }
  const globalLatest = [...pages, ...posts].reduce<Date | null>(
    (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
    null,
  )

  const urls = [
    // `/` is the site entrance; it drops out only when the `home` page itself is noindexed.
    ...(!home?.noindex
      ? [
          {
            loc: absoluteUrl(c.env.SITE_URL, '/'),
            lastmod: home?.updatedAt ?? globalLatest,
          },
        ]
      : []),
    ...pages
      .filter((page) => page.path !== 'home')
      .map((page) => ({
        loc: absoluteUrl(c.env.SITE_URL, `/${page.path}`),
        lastmod: page.updatedAt,
      })),
    ...indexableTypes.map((type) => ({
      loc: absoluteUrl(c.env.SITE_URL, `/${type.slug}`),
      lastmod: latestByType.get(type.id) ?? null,
    })),
    ...categories.flatMap((row) => {
      const typeSlug = typeSlugs.get(row.postTypeId)
      return typeSlug && indexableTypeIds.has(row.postTypeId)
        ? [
            {
              loc: absoluteUrl(c.env.SITE_URL, `/${typeSlug}/category/${row.slug}`),
              lastmod: row.updatedAt,
            },
          ]
        : []
    }),
    ...tags.flatMap((row) => {
      const typeSlug = typeSlugs.get(row.postTypeId)
      return typeSlug && indexableTypeIds.has(row.postTypeId)
        ? [
            {
              loc: absoluteUrl(c.env.SITE_URL, `/${typeSlug}/tag/${row.slug}`),
              lastmod: row.updatedAt,
            },
          ]
        : []
    }),
    ...authors.flatMap((row) => {
      const typeSlug = typeSlugs.get(row.postTypeId)
      return typeSlug && row.slug && indexableTypeIds.has(row.postTypeId)
        ? [
            {
              loc: absoluteUrl(c.env.SITE_URL, `/${typeSlug}/author/${row.slug}`),
              lastmod: row.updatedAt,
            },
          ]
        : []
    }),
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
  return xml(urls)
}

/** Admin-supplied robots.txt rules, normalised to LF with collapsed blank runs. */
function normalizeRobotsExtra(extra: string): string[] {
  const lines: string[] = []
  let blank = true // leading blank lines are dropped
  for (const raw of extra.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line === '') {
      if (!blank) {
        lines.push('')
        blank = true
      }
      continue
    }
    lines.push(line)
    blank = false
  }
  while (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * AI training crawlers and opt-out tokens, as listed in Cloudflare's managed
 * robots.txt (the same list EmDash uses). Search crawlers are not in it.
 */
export const AI_TRAINING_CRAWLERS = [
  'Amazonbot',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'ClaudeBot',
  'Google-Extended',
  'GPTBot',
  'meta-externalagent',
] as const

export async function robotsResponse(c: Context<AppEnv>) {
  const settings = await c.var.kanso.settings.site()
  const optOut = settings.disallowAiTraining
  const body = [
    'User-agent: *',
    // A signal, not a rule: it stays inside the `*` group, which keeps its Disallow lines.
    ...(optOut ? ['Content-Signal: search=yes, ai-train=no'] : []),
    // Not the admin: its pages say noindex (ADMIN_ROBOTS), which a crawler only
    // sees when it may fetch them, and the line would point everyone to the admin.
    'Disallow: /api',
    'Disallow: /preview',
    ...(optOut
      ? AI_TRAINING_CRAWLERS.flatMap((agent) => ['', `User-agent: ${agent}`, 'Disallow: /'])
      : []),
    ...(settings.robotsExtra ? ['', ...normalizeRobotsExtra(settings.robotsExtra)] : []),
    '',
    `Sitemap: ${absoluteUrl(c.env.SITE_URL, '/sitemap.xml')}`,
  ].join('\n')
  return c.body(body, 200, { 'content-type': 'text/plain; charset=utf-8' })
}

export async function feedResponse(c: Context<AppEnv>, type: PostType) {
  const [settings, result] = await Promise.all([
    c.var.kanso.settings.site(),
    // A feed is a timeline: pinned posts must not jump ahead of newer ones.
    c.var.kanso.posts.listPublished({
      postTypeId: type.id,
      page: 1,
      perPage: 20,
      order: 'newest',
    }),
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
  c.header('x-robots-tag', 'noindex')
  return c.body(body, 200, { 'content-type': 'application/atom+xml; charset=utf-8' })
}
