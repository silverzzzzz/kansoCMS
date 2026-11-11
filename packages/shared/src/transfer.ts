import { z } from 'zod'
import { contentStatusSchema } from './content.ts'
import { formFieldListSchema, notifyToSchema, redirectUrlSchema } from './forms.ts'
import { menuItemsSchema } from './menus.ts'
import { richTextDocSchema } from './richtext.ts'
import { pageSectionsSchema, sectionFieldListSchema } from './sections.ts'
import { SLUG_PATTERN, slugSchema } from './slug.ts'

export const EXPORT_BUNDLE_VERSION = 1

/**
 * How much one import request may carry. The import does a fixed number of
 * reads plus a few batched writes per request; these caps keep that inside
 * the 50 D1 queries a Workers Free invocation gets. Bigger files are sent in
 * several requests — `splitBundle` does the cutting.
 */
export const IMPORT_REQUEST_LIMITS = {
  postTypes: 100,
  categories: 500,
  tags: 500,
  pages: 100,
  posts: 100,
  redirects: 500,
  menus: 100,
  forms: 100,
} as const

/** Caps on a whole export file (not on a single request). */
const EXPORT_FILE_LIMITS = {
  postTypes: 100,
  categories: 5000,
  tags: 5000,
  pages: 5000,
  posts: 20000,
  redirects: 5000,
  menus: 100,
  forms: 100,
} as const

type BundleLimits = Record<keyof typeof IMPORT_REQUEST_LIMITS, number>

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

/** Full path without a leading slash; every segment is a slug. */
const pagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(
    (path) =>
      path.split('/').every((segment) => segment.length <= 120 && SLUG_PATTERN.test(segment)),
    'Every path segment must use lowercase letters, digits and hyphens only',
  )

const exportedPageSchema = z.object({
  /** Slug and parent are derived from the path. */
  path: pagePathSchema,
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

/** A form's definition. Submissions hold personal data and are never exported. */
const exportedFormSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  fields: formFieldListSchema,
  notifyTo: notifyToSchema.default(''),
  successMessage: z.string().trim().max(1000).default(''),
  redirectUrl: redirectUrlSchema.nullable().default(null),
  turnstile: z.boolean().default(false),
})

function bundleSchema(limits: BundleLimits) {
  return z.object({
    version: z.literal(EXPORT_BUNDLE_VERSION),
    exportedAt: z.string().max(100),
    /**
     * Site settings by key, present only when exported with `?settings=1`.
     * Keys that only mean something on the source site (the sample-content
     * manifest, the cache generation) are never part of a bundle.
     */
    settings: z.record(z.string(), z.unknown()).optional(),
    postTypes: z.array(exportedPostTypeSchema).max(limits.postTypes).default([]),
    categories: z.array(exportedCategorySchema).max(limits.categories).default([]),
    tags: z.array(exportedTagSchema).max(limits.tags).default([]),
    /** Informational: media rows are matched by key on import, never created. */
    media: z.array(exportedMediaSchema).max(20000).default([]),
    pages: z.array(exportedPageSchema).max(limits.pages).default([]),
    posts: z.array(exportedPostSchema).max(limits.posts).default([]),
    redirects: z.array(exportedRedirectSchema).max(limits.redirects).default([]),
    menus: z.array(exportedMenuSchema).max(limits.menus).default([]),
    forms: z.array(exportedFormSchema).max(limits.forms).default([]),
  })
}

/** A whole export file. */
export const exportBundleSchema = bundleSchema(EXPORT_FILE_LIMITS)
/** The body of one `POST /import` request: the same shape with per-request caps. */
export const importBundleSchema = bundleSchema(IMPORT_REQUEST_LIMITS)

export type ExportedPage = z.infer<typeof exportedPageSchema>
export type ExportedPost = z.infer<typeof exportedPostSchema>
export type ExportedForm = z.infer<typeof exportedFormSchema>
export type ExportBundle = z.infer<typeof exportBundleSchema>

/** Settings keys a bundle may carry. Everything else stays with its site. */
export const TRANSFERABLE_SETTINGS_KEYS = ['site', 'organization', 'forms', 'theme'] as const

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

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size))
  }
  return result
}

/** Parents before children, so a category's parent already exists when it arrives. */
function parentsFirst(categories: ExportBundle['categories']): ExportBundle['categories'] {
  const key = (postType: string, slug: string) => `${postType}/${slug}`
  const byKey = new Map(categories.map((item) => [key(item.postType, item.slug), item]))
  const depth = (item: ExportBundle['categories'][number], seen = new Set<string>()): number => {
    const own = key(item.postType, item.slug)
    const parent = item.parent === null ? undefined : byKey.get(key(item.postType, item.parent))
    if (!parent || seen.has(own)) return 0
    return 1 + depth(parent, new Set(seen).add(own))
  }
  return categories
    .map((item, index) => ({ item, index, depth: depth(item) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((entry) => entry.item)
}

/** Pages sorted so that a parent path always comes before its children. */
function shallowFirst(pages: ExportBundle['pages']): ExportBundle['pages'] {
  return pages
    .map((item, index) => ({ item, index, depth: item.path.split('/').length }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((entry) => entry.item)
}

/**
 * Cut an export file into import requests that each respect
 * `IMPORT_REQUEST_LIMITS`, in an order that keeps references resolvable:
 * post types, taxonomies, forms, menus and redirects first, then pages
 * (parents before children), then posts, and settings last (they may point
 * at a page created earlier). A small file comes back as a single request.
 *
 * Pages and posts go 25 to a request by default — a quarter of what the
 * server accepts. The query count would allow more; the margin is for CPU
 * time, which Workers Free caps at 10 ms per request and local development
 * cannot measure.
 */
export function splitBundle(
  bundle: ExportBundle,
  options: { contentPerRequest?: number } = {},
): ExportBundle[] {
  const contentPerRequest = Math.min(
    options.contentPerRequest ?? 25,
    IMPORT_REQUEST_LIMITS.pages,
    IMPORT_REQUEST_LIMITS.posts,
  )
  const empty = (): ExportBundle => ({
    version: EXPORT_BUNDLE_VERSION,
    exportedAt: bundle.exportedAt,
    postTypes: [],
    categories: [],
    tags: [],
    media: [],
    pages: [],
    posts: [],
    redirects: [],
    menus: [],
    forms: [],
  })

  const parts: ExportBundle[] = []
  const tagChunks = chunks(bundle.tags, IMPORT_REQUEST_LIMITS.tags)
  const categoryChunks = chunks(parentsFirst(bundle.categories), IMPORT_REQUEST_LIMITS.categories)
  const redirectChunks = chunks(bundle.redirects, IMPORT_REQUEST_LIMITS.redirects)
  const structureParts = Math.max(1, tagChunks.length, categoryChunks.length, redirectChunks.length)
  for (let index = 0; index < structureParts; index += 1) {
    parts.push({
      ...empty(),
      ...(index === 0
        ? { postTypes: bundle.postTypes, menus: bundle.menus, forms: bundle.forms }
        : {}),
      tags: tagChunks[index] ?? [],
      categories: categoryChunks[index] ?? [],
      redirects: redirectChunks[index] ?? [],
    })
  }
  for (const pages of chunks(shallowFirst(bundle.pages), contentPerRequest)) {
    parts.push({ ...empty(), pages })
  }
  for (const posts of chunks(bundle.posts, contentPerRequest)) {
    parts.push({ ...empty(), posts })
  }
  if (bundle.settings !== undefined) parts.push({ ...empty(), settings: bundle.settings })

  // Drop a leading structure part that turned out empty (e.g. a posts-only file).
  const isEmpty = (part: ExportBundle) =>
    part.settings === undefined &&
    part.postTypes.length +
      part.categories.length +
      part.tags.length +
      part.pages.length +
      part.posts.length +
      part.redirects.length +
      part.menus.length +
      part.forms.length ===
      0
  const nonEmpty = parts.filter((part) => !isEmpty(part))
  return nonEmpty.length > 0 ? nonEmpty : [empty()]
}
