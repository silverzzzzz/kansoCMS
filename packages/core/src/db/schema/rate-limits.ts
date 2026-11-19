import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Fixed-window request counters for public endpoints (login, setup, form
 * submissions). `key` is `<bucket>:<hash of the client IP>`; the row is
 * reused across windows, so a client costs one row however long it stays.
 */
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  /** Unix seconds at which the current window started. */
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull(),
})
