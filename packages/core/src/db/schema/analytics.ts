import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Cookie-less pageview counts, one row per (day, path). `day` is a `YYYY-MM-DD`
 * key in the site's timezone (settings.timezone), computed at write time.
 */
export const pageviewDaily = sqliteTable(
  'pageview_daily',
  {
    day: text('day').notNull(),
    path: text('path').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.path] })],
)
