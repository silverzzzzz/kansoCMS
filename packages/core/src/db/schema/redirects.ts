import type { RedirectStatus } from '@kanso/shared'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { timestamps } from './_columns.ts'

export const redirects = sqliteTable('redirects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fromPath: text('from_path').notNull().unique(),
  to: text('to').notNull(),
  status: integer('status').notNull().default(301).$type<RedirectStatus>(),
  ...timestamps,
})
