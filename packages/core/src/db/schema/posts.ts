import type { SectionField, SectionValues } from '@kanso/shared'
import { isNull } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { contentColumns, seoColumns, timestamps } from './_columns.ts'
import { users } from './auth.ts'
import { media } from './media.ts'

/** A "kind" of blog: `blog`, `news`, `works`, ... Owns the `/:slug` URL prefix. */
export const postTypes = sqliteTable('post_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  hasCategories: integer('has_categories', { mode: 'boolean' }).notNull().default(true),
  hasTags: integer('has_tags', { mode: 'boolean' }).notNull().default(true),
  /** Archive URLs only (`/type`, `/type/category/*`, `/type/tag/*`); posts keep their own flag. */
  noindex: integer('noindex', { mode: 'boolean' }).notNull().default(false),
  /** Custom field definitions (the section field DSL); posts store values in `fields_json`. */
  fieldsJson: text('fields_json', { mode: 'json' }).$type<SectionField[]>(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
})

export const posts = sqliteTable(
  'posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postTypeId: integer('post_type_id')
      .notNull()
      .references(() => postTypes.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    coverMediaId: integer('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
    authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Sticky posts sort before others in archive lists. */
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    /** Custom field values, validated against `post_types.fields_json` at write time. */
    fieldsJson: text('fields_json', { mode: 'json' }).$type<SectionValues>(),
    ...contentColumns,
    ...seoColumns,
    ogMediaId: integer('og_media_id').references(() => media.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('posts_type_slug_uq').on(t.postTypeId, t.slug).where(isNull(t.deletedAt)),
    index('posts_type_status_published_idx').on(t.postTypeId, t.status, t.publishedAt),
  ],
)

/** Categories are scoped to a post type; a `news` category never shows under `blog`. */
export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postTypeId: integer('post_type_id')
      .notNull()
      .references(() => postTypes.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    parentId: integer('parent_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('categories_type_slug_uq').on(t.postTypeId, t.slug)],
)

/** Tags are global across post types. */
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
})

export const postCategories = sqliteTable(
  'post_categories',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.categoryId] })],
)

export const postTags = sqliteTable(
  'post_tags',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] })],
)
