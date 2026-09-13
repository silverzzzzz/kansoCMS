import { escapeXml } from './xml.ts'

export interface FeedEntry {
  url: string
  title: string
  summary?: string | null
  publishedAt: Date
  updatedAt: Date
  authorName?: string | null
}

export interface FeedInput {
  title: string
  subtitle?: string | null
  siteUrl: string
  feedUrl: string
  updated: Date | null
  entries: FeedEntry[]
}

function link(rel: 'self' | 'alternate', href: string): string {
  return `<link rel="${rel}" href="${escapeXml(href)}"/>`
}

export function buildAtomFeed(input: FeedInput): string {
  const entries = input.entries
    .map(
      (entry) =>
        `<entry><id>${escapeXml(entry.url)}</id><title>${escapeXml(entry.title)}</title>${link(
          'alternate',
          entry.url,
        )}<published>${entry.publishedAt.toISOString()}</published><updated>${entry.updatedAt.toISOString()}</updated>${
          entry.summary ? `<summary type="text">${escapeXml(entry.summary)}</summary>` : ''
        }${
          entry.authorName ? `<author><name>${escapeXml(entry.authorName)}</name></author>` : ''
        }</entry>`,
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${escapeXml(
    input.feedUrl,
  )}</id><title>${escapeXml(input.title)}</title>${
    input.subtitle ? `<subtitle>${escapeXml(input.subtitle)}</subtitle>` : ''
  }${link('self', input.feedUrl)}${link('alternate', input.siteUrl)}<updated>${(
    input.updated ?? new Date()
  ).toISOString()}</updated>${entries}</feed>`
}
