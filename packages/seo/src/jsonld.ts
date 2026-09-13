import type {
  BlogPosting,
  BreadcrumbList,
  CollectionPage,
  Organization,
  Thing,
  WebPage,
  WebSite,
  WithContext,
} from 'schema-dts'

export interface SiteContext {
  /** Absolute origin, no trailing slash: `https://example.com` */
  url: string
  name: string
  description?: string
  locale?: string
  organization?: {
    name: string
    url?: string | null
    logoUrl?: string | null
    sameAs?: string[]
  }
}

const withContext = <T extends Thing>(thing: T): WithContext<T> =>
  ({ '@context': 'https://schema.org', ...(thing as object) }) as WithContext<T>

export function buildOrganization(site: SiteContext): WithContext<Organization> | null {
  const org = site.organization
  if (!org?.name) return null
  return withContext<Organization>({
    '@type': 'Organization',
    '@id': `${site.url}/#organization`,
    name: org.name,
    url: org.url ?? site.url,
    ...(org.logoUrl ? { logo: org.logoUrl } : {}),
    ...(org.sameAs?.length ? { sameAs: org.sameAs } : {}),
  })
}

export function buildWebSite(site: SiteContext): WithContext<WebSite> {
  return withContext<WebSite>({
    '@type': 'WebSite',
    '@id': `${site.url}/#website`,
    url: site.url,
    name: site.name,
    ...(site.description ? { description: site.description } : {}),
    ...(site.locale ? { inLanguage: site.locale } : {}),
    ...(site.organization?.name ? { publisher: { '@id': `${site.url}/#organization` } } : {}),
  })
}

export interface PageInput {
  url: string
  title: string
  description?: string | null
  publishedAt?: Date | null
  updatedAt?: Date | null
}

export function buildWebPage(site: SiteContext, page: PageInput): WithContext<WebPage> {
  return withContext<WebPage>({
    '@type': 'WebPage',
    '@id': page.url,
    url: page.url,
    name: page.title,
    isPartOf: { '@id': `${site.url}/#website` },
    ...(page.description ? { description: page.description } : {}),
    ...(site.locale ? { inLanguage: site.locale } : {}),
    ...(page.publishedAt ? { datePublished: page.publishedAt.toISOString() } : {}),
    ...(page.updatedAt ? { dateModified: page.updatedAt.toISOString() } : {}),
  })
}

export function buildCollectionPage(
  site: SiteContext,
  page: Pick<PageInput, 'url' | 'title' | 'description'>,
): WithContext<CollectionPage> {
  return withContext<CollectionPage>({
    '@type': 'CollectionPage',
    '@id': page.url,
    url: page.url,
    name: page.title,
    isPartOf: { '@id': `${site.url}/#website` },
    ...(page.description ? { description: page.description } : {}),
    ...(site.locale ? { inLanguage: site.locale } : {}),
  })
}

export interface PostInput extends PageInput {
  imageUrl?: string | null
  authorName?: string | null
  tags?: string[]
}

export function buildBlogPosting(site: SiteContext, post: PostInput): WithContext<BlogPosting> {
  return withContext<BlogPosting>({
    '@type': 'BlogPosting',
    '@id': post.url,
    url: post.url,
    mainEntityOfPage: post.url,
    headline: post.title,
    ...(post.description ? { description: post.description } : {}),
    ...(post.imageUrl ? { image: post.imageUrl } : {}),
    ...(post.publishedAt ? { datePublished: post.publishedAt.toISOString() } : {}),
    ...(post.updatedAt ? { dateModified: post.updatedAt.toISOString() } : {}),
    ...(post.authorName ? { author: { '@type': 'Person', name: post.authorName } } : {}),
    ...(site.organization?.name ? { publisher: { '@id': `${site.url}/#organization` } } : {}),
    ...(post.tags?.length ? { keywords: post.tags.join(', ') } : {}),
    ...(site.locale ? { inLanguage: site.locale } : {}),
  })
}

export interface Crumb {
  name: string
  url: string
}

export function buildBreadcrumb(crumbs: Crumb[]): WithContext<BreadcrumbList> {
  return withContext<BreadcrumbList>({
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  })
}

/**
 * Serialize for embedding in `<script type="application/ld+json">`.
 * Escapes `<` so a `</script>` inside content cannot break out of the tag.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
