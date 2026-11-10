import type { MenuItem } from '@kanso/shared'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { timestamps } from './_columns.ts'

/**
 * Navigation menus are stored as JSON item trees (label/href/children) the same
 * way forms store field definitions — they are always read as a whole.
 */
export const menus = sqliteTable('menus', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  itemsJson: text('items_json', { mode: 'json' }).notNull().$type<MenuItem[]>(),
  ...timestamps,
})
