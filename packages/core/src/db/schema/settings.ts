import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Key/value store for site-wide settings. Values are zod-validated JSON. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json', { mode: 'json' }).notNull().$type<unknown>(),
})
