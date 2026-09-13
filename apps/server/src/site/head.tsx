import { type PageMeta, serializeJsonLd } from '@kanso/seo'
import { raw } from 'hono/html'

export interface HeadProps {
  meta: PageMeta
  /** Already-built JSON-LD objects (WebSite, WebPage, BlogPosting, ...). */
  jsonLd?: unknown[]
}

/**
 * The one place that emits title / description / canonical / OG / JSON-LD.
 * Themes render `<Head meta={...} jsonLd={[...]} />` and never touch meta tags.
 */
export function Head({ meta, jsonLd = [] }: HeadProps) {
  return (
    <>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{meta.title}</title>
      {meta.description && <meta name="description" content={meta.description} />}
      <link rel="canonical" href={meta.canonical} />
      {meta.prev && <link rel="prev" href={meta.prev} />}
      {meta.next && <link rel="next" href={meta.next} />}
      {meta.feed && (
        <link
          rel="alternate"
          type="application/atom+xml"
          title={meta.feed.title}
          href={meta.feed.href}
        />
      )}
      {meta.noindex && <meta name="robots" content="noindex, nofollow" />}

      <meta property="og:type" content={meta.ogType} />
      <meta property="og:title" content={meta.title} />
      {meta.description && <meta property="og:description" content={meta.description} />}
      <meta property="og:url" content={meta.canonical} />
      <meta property="og:site_name" content={meta.siteName} />
      <meta property="og:locale" content={meta.locale.replace('-', '_')} />
      {meta.ogImage && <meta property="og:image" content={meta.ogImage} />}
      {meta.ogType === 'article' && meta.publishedAt && (
        <meta property="article:published_time" content={meta.publishedAt.toISOString()} />
      )}
      {meta.ogType === 'article' && meta.updatedAt && (
        <meta property="article:modified_time" content={meta.updatedAt.toISOString()} />
      )}
      <meta name="twitter:card" content={meta.ogImage ? 'summary_large_image' : 'summary'} />

      {jsonLd.filter(Boolean).map((data) => (
        <script type="application/ld+json">{raw(serializeJsonLd(data))}</script>
      ))}
    </>
  )
}
