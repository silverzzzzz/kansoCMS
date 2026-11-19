import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Public paths that answered 404 (no page, post type or redirect), counted so
 * the redirects screen can offer to fix them. `path` is normalised like
 * `redirects.from_path` (no leading or trailing slash, no query string).
 * Rows not seen for 30 days, and the oldest beyond 1,000, are purged daily.
 */
export const notFoundPaths = sqliteTable('not_found_paths', {
  path: text('path').primaryKey(),
  count: integer('count').notNull().default(0),
  /** Unix seconds. */
  firstSeen: integer('first_seen').notNull(),
  /** Unix seconds. The table stays small (at most 1,000 rows after the purge), so no index. */
  lastSeen: integer('last_seen').notNull(),
})
