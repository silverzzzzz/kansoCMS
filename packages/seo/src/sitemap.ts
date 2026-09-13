import { escapeXml } from './xml.ts'

export interface SitemapUrl {
  loc: string
  lastmod?: Date | null
}

export function buildSitemap(urls: SitemapUrl[]): string {
  const entries = urls
    .map(
      ({ loc, lastmod }) =>
        `<url><loc>${escapeXml(loc)}</loc>${
          lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''
        }</url>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`
}
