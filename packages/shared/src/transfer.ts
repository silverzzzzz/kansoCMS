import { z } from 'zod'
import { contentStatusSchema } from './content.ts'
import { menuItemsSchema } from './menus.ts'
import { richTextDocSchema } from './richtext.ts'
import { pageSectionsSchema, sectionFieldListSchema } from './sections.ts'
import { slugSchema } from './slug.ts'

export const EXPORT_BUNDLE_VERSION = 1

/**
 * Cross-environment content bundle (WP WXR equivalent). References travel as
 * slugs/keys — never as local ids — so `postType`, `parent`, `author`,
 * `coverMedia`/`ogMedia` and page `path` resolve on import.
 */
const exportedPostTypeSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().default(null),
  hasCategories: z.boolean().default(true),
  hasTags: z.boolean().default(true),
  noindex: z.boolean().default(false),
  fields: sectionFieldListSchema.nullable().default(null),
  sortOrder: z.number().int().default(0),
})

const exportedCategorySchema = z.object({
  postType: slugSchema,
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  parent: slugSchema.nullable().default(null),
  sortOrder: z.number().int().default(0),
})

const exportedTagSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
})

/** Media metadata only; the R2 binary never leaves the bucket. */
const exportedMediaSchema = z.object({
  key: z.string().min(1).max(1024),
  filename: z.string().max(500),
  mime: z.string().max(200),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  alt: z.string().nullable().default(null),
})

const exportedSeoFields = {
  seoTitle: z.string().trim().max(120).nullable().default(null),
  seoDescription: z.string().trim().max(320).nullable().default(null),
  noindex: z.boolean().default(false),
  canonicalUrl: z.url().nullable().default(null),
  /** Media R2 key; resolves to `og_media_id` on import. */
  ogMedia: z.string().nullable().default(null),
} as const

const exportedContentFields = {
  title: z.string().trim().min(1).max(200),
  bodyJson: richTextDocSchema.nullable().default(null),
  excerpt: z.string().trim().max(500).nullable().default(null),
  status: contentStatusSchema.default('draft'),
  publishedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  ...exportedSeoFields,
} as const

const exportedPageSchema = z.object({
  /** Full path without a leading slash; slug and parent are derived from it. */
  path: z.string().trim().min(1).max(1000),
  sortOrder: z.number().int().default(0),
  sections: pageSectionsSchema.nullable().default(null),
  ...exportedContentFields,
})

const exportedPostSchema = z.object({
  postType: slugSchema,
  slug: slugSchema,
  pinned: z.boolean().default(false),
  fields: z.record(z.string(), z.unknown()).nullable().default(null),
  categories: z.array(slugSchema).max(50).default([]),
  tags: z.array(slugSchema).max(50).default([]),
  author: slugSchema.nullable().default(null),
  coverMedia: z.string().nullable().default(null),
  ...exportedContentFields,
})

const exportedRedirectSchema = z.object({
  fromPath: z.string().trim().min(1).max(2000),
  to: z.string().trim().min(1).max(2000),
  status: z.union([z.literal(301), z.literal(302)]).default(301),
})

const exportedMenuSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  items: menuItemsSchema.default([]),
})

export const exportBundleSchema = z.object({
  version: z.literal(EXPORT_BUNDLE_VERSION),
  exportedAt: z.string().max(100),
  /** Whole `settings` table as key → value; present only when exported with `?settings=1`. */
  settings: z.record(z.string(), z.unknown()).optional(),
  postTypes: z.array(exportedPostTypeSchema).max(100).default([]),
  categories: z.array(exportedCategorySchema).max(2000).default([]),
  tags: z.array(exportedTagSchema).max(2000).default([]),
  media: z.array(exportedMediaSchema).max(10000).default([]),
  pages: z.array(exportedPageSchema).max(5000).default([]),
  posts: z.array(exportedPostSchema).max(20000).default([]),
  redirects: z.array(exportedRedirectSchema).max(5000).default([]),
  menus: z.array(exportedMenuSchema).max(100).default([]),
})

export type ExportedPage = z.infer<typeof exportedPageSchema>
export type ExportedPost = z.infer<typeof exportedPostSchema>
export type ExportBundle = z.infer<typeof exportBundleSchema>

export const exportQuerySchema = z.object({
  settings: z.enum(['1']).optional(),
})

export type ImportReport = {
  created: number
  updated: number
  /** Unchanged rows plus rows that failed validation or had unresolvable parents. */
  skipped: number
  warnings: string[]
}
