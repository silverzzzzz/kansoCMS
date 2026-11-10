/** Everything a theme's <Head> needs, resolved from site settings + content. */
export interface PageMeta {
  title: string
  description: string
  canonical: string
  locale: string
  siteName: string
  /** Site-wide description (settings), for theme mastheads; `description` is the page's own. */
  siteDescription?: string
  ogType: 'website' | 'article'
  ogImage?: string | null
  /** `twitter:site` value (`@handle`), from the organisation settings. */
  twitterSite?: string | null
  noindex: boolean
  publishedAt?: Date | null
  updatedAt?: Date | null
  prev?: string | null
  next?: string | null
  feed?: { href: string; title: string } | null
}

export interface BuildTitleOptions {
  siteName: string
  separator?: string
}

/** `Page title | Site name`, or just the site name on the home page. */
export function buildTitle(pageTitle: string | null | undefined, opts: BuildTitleOptions): string {
  const sep = opts.separator ?? ' | '
  if (!pageTitle || pageTitle === opts.siteName) return opts.siteName
  return `${pageTitle}${sep}${opts.siteName}`
}

/** Plain-text excerpt from HTML for meta descriptions. Whitespace-normalized. */
export function excerptFromHtml(html: string, maxLength = 160): string {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, `${origin}/`).toString()
}

/**
 * OGP `og:locale` (`language_TERRITORY`) from a BCP 47 tag. A bare language
 * like `ja` is invalid for Facebook; `Intl.Locale.maximize()` fills in the
 * likely region (`ja_JP`). Unparseable input is passed through with `-`
 * normalised to `_`.
 */
export function toOgLocale(locale: string): string {
  try {
    const { language, region } = new Intl.Locale(locale).maximize()
    if (region) return `${language}_${region}`
  } catch {
    // fall through to the tag as written
  }
  return locale.replace('-', '_')
}
