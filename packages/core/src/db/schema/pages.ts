import type { PageSection } from '@kanso/shared'
import { isNull } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { contentColumns, seoColumns, timestamps } from './_columns.ts'
import { media } from './media.ts'

/**
 * Hierarchical static pages. `path` is the full URL path without a leading
 * slash (`company/about`) and is recomputed whenever a page or any ancestor
 * changes slug/parent. Routing matches on `path`, never on `slug`.
 */
export const pages = sqliteTable(
  'pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    path: text('path').notNull(),
    parentId: integer('parent_id').references((): AnySQLiteColumn => pages.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    sectionsJson: text('sections_json', { mode: 'json' }).$type<PageSection[]>(),
    ...contentColumns,
    ...seoColumns,
    ogMediaId: integer('og_media_id').references(() => media.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    // Partial unique: a trashed page keeps its path without blocking a replacement.
    uniqueIndex('pages_path_uq').on(t.path).where(isNull(t.deletedAt)),
    index('pages_status_published_idx').on(t.status, t.publishedAt),
  ],
)
