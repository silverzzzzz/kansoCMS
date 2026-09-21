import type { RichTextDoc } from '@kanso/shared'
import { CONTENT_STATUSES } from '@kanso/shared'
import { sql } from 'drizzle-orm'
import { integer, text } from 'drizzle-orm/sqlite-core'

const unixNow = sql`(unixepoch())`

export const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(unixNow),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(unixNow),
}

/**
 * SEO columns shared by pages and posts. `ogMediaId` is declared here without
 * a foreign key; tables add `.references(() => media.id)` themselves to avoid a
 * circular import.
 */
export const seoColumns = {
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  noindex: integer('noindex', { mode: 'boolean' }).notNull().default(false),
  canonicalUrl: text('canonical_url'),
}

/** Rich text body + publishing state shared by pages and posts. */
export const contentColumns = {
  title: text('title').notNull(),
  bodyJson: text('body_json', { mode: 'json' }).$type<RichTextDoc>(),
  bodyHtml: text('body_html').notNull().default(''),
  searchText: text('search_text').notNull().default(''),
  excerpt: text('excerpt'),
  status: text('status', { enum: CONTENT_STATUSES }).notNull().default('draft'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
}
