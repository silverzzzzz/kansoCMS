import {
  createRedirectSchema,
  EXPORT_BUNDLE_VERSION,
  type ExportBundle,
  formsSettingsSchema,
  type ImportReport,
  isReservedSlug,
  organizationSettingsSchema,
  type PageRevisionSnapshot,
  type PostRevisionSnapshot,
  SETTINGS_KEYS,
  type SectionField,
  siteSettingsSchema,
  TRANSFERABLE_SETTINGS_KEYS,
  themeSettingsSchema,
} from '@kanso/shared'
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { EMPTY_DOCUMENT } from '../content/index.ts'
import type { Db } from '../db/client.ts'
import {
  categories,
  forms,
  media,
  menus,
  pages,
  postCategories,
  posts,
  postTags,
  postTypes,
  redirects,
  settings,
  tags,
  users,
} from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'
import { formInsertValues } from './forms.ts'
import { pageInsertValues } from './pages.ts'
import { postTypeInsertValues } from './post-types.ts'
import { parsePostFields, postInsertValues } from './posts.ts'
import { revisionsService } from './revisions.ts'

/**
 * Field definitions of a page section type, from the theme catalog (which
 * lives outside core). With it, image settings inside sections travel by
 * media key like every other media reference; without it they are left as
 * they are.
 */
export type SectionFieldsLookup = (sectionType: string) => SectionField[] | undefined

export type ImportContext = {
  allowRawHtml: boolean
  userId: number | null
  /** Site settings are admin-only everywhere; the import follows the same rule. */
  canImportSettings: boolean
  /** Forms may only require Turnstile where its secret is configured. */
  turnstileAvailable: boolean
  sectionFields?: SectionFieldsLookup
}

type BatchItem = Parameters<Db['batch']>[0][number]
type Write = { statement: BatchItem; weight: number }
type WarningSink = (message: string) => void

/** Statements per `db.batch()`, and a size cap so one batch never carries megabytes of bodies. */
const BATCH_STATEMENTS = 40
const BATCH_WEIGHT = 900_000
/** `in (...)` lists stay well under D1's 100 bound parameters per query. */
const IN_LIST = 90
/** Rows per multi-row insert: each row binds up to 4 values. */
const ROWS_PER_INSERT = 20

/** Settings object fields holding a `media.id`; exported as `{ $ref: 'media', key }`. */
const SETTINGS_MEDIA_FIELDS: Record<string, readonly string[]> = {
  [SETTINGS_KEYS.site]: ['logoMediaId', 'ogImageMediaId', 'faviconMediaId'],
  [SETTINGS_KEYS.organization]: ['logoMediaId'],
}
/** Settings object fields holding a `pages.id`; exported as `{ $ref: 'page', path }`. */
const SETTINGS_PAGE_FIELDS: Record<string, readonly string[]> = {
  [SETTINGS_KEYS.site]: ['notFoundPageId'],
}
/**
 * Only these keys travel. `starter` lists row ids of the source site's sample
 * content — imported elsewhere, "remove sample content" would delete whatever
 * happens to own those ids — and `cache` is a per-site generation counter.
 */
const SETTINGS_SCHEMAS: Record<string, z.ZodType> = {
  [SETTINGS_KEYS.site]: siteSettingsSchema,
  [SETTINGS_KEYS.organization]: organizationSettingsSchema,
  [SETTINGS_KEYS.forms]: formsSettingsSchema,
  [SETTINGS_KEYS.theme]: themeSettingsSchema,
}
const TRANSFERABLE = new Set<string>(TRANSFERABLE_SETTINGS_KEYS)

/** Deterministic JSON: object keys are sorted recursively so equality survives re-encoding. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortDeep(item)]),
    )
  }
  return value
}

export function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** `a/b/c` → `{ slug: 'c', parentPath: 'a/b' }`; top-level paths have `parentPath: null`. */
export function pageIdentity(path: string): { slug: string; parentPath: string | null } {
  const index = path.lastIndexOf('/')
  return index === -1
    ? { slug: path, parentPath: null }
    : { slug: path.slice(index + 1), parentPath: path.slice(0, index) }
}

/** Parents first so a bundle can be imported in array order. */
export function sortByPathDepth<T extends { path: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || (a.path < b.path ? -1 : 1),
  )
}

function chunked<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size))
  }
  return result
}

/** Rough bytes a statement binds: what keeps a batch of long bodies from growing unbounded. */
function weigh(values: Record<string, unknown>): number {
  let total = 200
  for (const value of Object.values(values)) {
    if (typeof value === 'string') total += value.length
    else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      total += JSON.stringify(value)?.length ?? 0
    }
  }
  return total
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

/**
 * Media ids only mean something inside one database. Values of `image`
 * fields — in page sections and in post custom fields — are therefore
 * exported as `{ $ref: 'media', key }` and resolved against the target
 * site's media on import, exactly like cover and OG images.
 */
function encodeImageFields(
  fields: SectionField[] | null | undefined,
  values: Record<string, unknown>,
  mediaKey: (id: number | null) => string | null,
): Record<string, unknown> {
  const images = (fields ?? []).filter((field) => field.type === 'image')
  if (images.length === 0) return values
  const encoded = { ...values }
  for (const field of images) {
    const id = encoded[field.name]
    if (typeof id === 'number') encoded[field.name] = { $ref: 'media', key: mediaKey(id) }
  }
  return encoded
}

function decodeImageFields(
  fields: SectionField[] | null | undefined,
  values: Record<string, unknown>,
  resolve: (key: string | null, owner: string) => number | null,
  owner: string,
  warn: WarningSink,
): Record<string, unknown> {
  const images = (fields ?? []).filter((field) => field.type === 'image')
  if (images.length === 0) return values
  const decoded = { ...values }
  for (const field of images) {
    const value = decoded[field.name]
    if (value === null || value === undefined) continue
    if (typeof value === 'object' && !Array.isArray(value)) {
      const key = (value as { key?: unknown }).key
      decoded[field.name] = typeof key === 'string' ? resolve(key, owner) : null
    } else {
      // A bare id belongs to the site that exported it; never trust it here.
      decoded[field.name] = null
      warn(`${owner}: image "${field.name}" has no media key; cleared`)
    }
  }
  return decoded
}

export function transferService(db: Db) {
  const revisions = revisionsService(db)

  async function exportBundle(options: {
    settings: boolean
    sectionFields?: SectionFieldsLookup
  }): Promise<ExportBundle> {
    const [
      typeRows,
      categoryRows,
      tagRows,
      mediaRows,
      pageRows,
      postRows,
      redirectRows,
      menuRows,
      formRows,
      settingRows,
      userRows,
      categoryLinks,
      tagLinks,
    ] = await Promise.all([
      db.query.postTypes.findMany({ orderBy: [asc(postTypes.sortOrder), asc(postTypes.id)] }),
      db.query.categories.findMany(),
      db.query.tags.findMany({ orderBy: [asc(tags.slug)] }),
      db.query.media.findMany({ orderBy: [asc(media.id)] }),
      db.query.pages.findMany({
        where: isNull(pages.deletedAt),
        columns: { searchText: false },
        orderBy: [asc(pages.path)],
      }),
      db.query.posts.findMany({
        where: isNull(posts.deletedAt),
        columns: { searchText: false },
        orderBy: [asc(posts.postTypeId), asc(posts.slug)],
      }),
      db.query.redirects.findMany({ orderBy: [asc(redirects.fromPath)] }),
      db.query.menus.findMany({ orderBy: [asc(menus.slug)] }),
      db.query.forms.findMany({ orderBy: [asc(forms.slug)] }),
      options.settings
        ? db.query.settings.findMany()
        : Promise.resolve([] as (typeof settings.$inferSelect)[]),
      db.select({ id: users.id, slug: users.slug }).from(users),
      db
        .select({ postId: postCategories.postId, slug: categories.slug })
        .from(postCategories)
        .innerJoin(categories, eq(categories.id, postCategories.categoryId)),
      db
        .select({ postId: postTags.postId, slug: tags.slug })
        .from(postTags)
        .innerJoin(tags, eq(tags.id, postTags.tagId)),
    ])

    const typeById = new Map(typeRows.map((row) => [row.id, row]))
    const categoryById = new Map(categoryRows.map((row) => [row.id, row]))
    const mediaById = new Map(mediaRows.map((row) => [row.id, row]))
    const pageById = new Map(pageRows.map((row) => [row.id, row]))
    const userById = new Map(userRows.map((row) => [row.id, row]))
    const mediaKey = (id: number | null) =>
      id === null ? null : (mediaById.get(id)?.r2Key ?? null)
    const livePostIds = new Set(postRows.map((row) => row.id))
    const categorySlugsOf = new Map<number, string[]>()
    for (const link of categoryLinks) {
      if (!livePostIds.has(link.postId)) continue
      categorySlugsOf.set(link.postId, [...(categorySlugsOf.get(link.postId) ?? []), link.slug])
    }
    const tagSlugsOf = new Map<number, string[]>()
    for (const link of tagLinks) {
      if (!livePostIds.has(link.postId)) continue
      tagSlugsOf.set(link.postId, [...(tagSlugsOf.get(link.postId) ?? []), link.slug])
    }

    const bundle: ExportBundle = {
      version: EXPORT_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      postTypes: typeRows.map((row) => ({
        slug: row.slug,
        name: row.name,
        description: row.description,
        hasCategories: row.hasCategories,
        hasTags: row.hasTags,
        noindex: row.noindex,
        fields: row.fieldsJson,
        sortOrder: row.sortOrder,
      })),
      categories: categoryRows.map((row) => ({
        postType: typeById.get(row.postTypeId)?.slug ?? '',
        slug: row.slug,
        name: row.name,
        parent: row.parentId === null ? null : (categoryById.get(row.parentId)?.slug ?? null),
        sortOrder: row.sortOrder,
      })),
      tags: tagRows.map((row) => ({ slug: row.slug, name: row.name })),
      media: mediaRows.map((row) => ({
        key: row.r2Key,
        filename: row.filename,
        mime: row.mime,
        size: row.size,
        width: row.width,
        height: row.height,
        alt: row.alt,
      })),
      pages: sortByPathDepth(pageRows).map((row) => ({
        path: row.path,
        sortOrder: row.sortOrder,
        sections:
          row.sectionsJson?.map((section) => ({
            ...section,
            settings: encodeImageFields(
              options.sectionFields?.(section.type),
              section.settings,
              mediaKey,
            ),
          })) ?? null,
        title: row.title,
        bodyJson: row.bodyJson,
        excerpt: row.excerpt,
        status: row.status,
        publishedAt: toIso(row.publishedAt),
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        noindex: row.noindex,
        canonicalUrl: row.canonicalUrl,
        ogMedia: mediaKey(row.ogMediaId),
      })),
      posts: postRows.map((row) => ({
        postType: typeById.get(row.postTypeId)?.slug ?? '',
        slug: row.slug,
        pinned: row.pinned,
        fields:
          row.fieldsJson === null
            ? null
            : encodeImageFields(typeById.get(row.postTypeId)?.fieldsJson, row.fieldsJson, mediaKey),
        categories: categorySlugsOf.get(row.id) ?? [],
        tags: tagSlugsOf.get(row.id) ?? [],
        author: row.authorId === null ? null : (userById.get(row.authorId)?.slug ?? null),
        coverMedia: mediaKey(row.coverMediaId),
        title: row.title,
        bodyJson: row.bodyJson,
        excerpt: row.excerpt,
        status: row.status,
        publishedAt: toIso(row.publishedAt),
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        noindex: row.noindex,
        canonicalUrl: row.canonicalUrl,
        ogMedia: mediaKey(row.ogMediaId),
      })),
      redirects: redirectRows.map((row) => ({
        fromPath: row.fromPath,
        to: row.to,
        status: row.status,
      })),
      menus: menuRows.map((row) => ({ slug: row.slug, name: row.name, items: row.itemsJson })),
      forms: formRows.map((row) => ({
        slug: row.slug,
        name: row.name,
        fields: row.fieldsJson,
        notifyTo: row.notifyTo,
        successMessage: row.successMessage,
        redirectUrl: row.redirectUrl,
        turnstile: row.turnstile,
      })),
    }

    if (options.settings) {
      bundle.settings = Object.fromEntries(
        settingRows
          .filter((row) => TRANSFERABLE.has(row.key))
          .map((row) => [
            row.key,
            encodeSettingsValue(row.key, row.valueJson, mediaById, pageById),
          ]),
      )
    }
    return bundle
  }

  /**
   * Upsert a bundle by slug/path. Set-based on purpose: a fixed number of
   * reads, an in-memory diff, then batched writes — so a request's D1 query
   * count does not grow with the number of items (going through the per-item
   * services cost ~7 queries a post and broke the Workers Free limit of 50
   * after a handful of posts).
   *
   * References to rows created by this same import are resolved inside the
   * statements with slug/path subqueries, so no ids need to be read back.
   * Everything is validated in memory first; an item that cannot be imported
   * is reported as a warning and skipped, never left to fail a batch.
   */
  async function importBundle(bundle: ExportBundle, context: ImportContext): Promise<ImportReport> {
    const report: ImportReport = { created: 0, updated: 0, skipped: 0, warnings: [] }
    const warn: WarningSink = (message) => report.warnings.push(message)
    const skip = (label: string, reason: string) => {
      report.skipped += 1
      warn(`${label}: ${reason}`)
    }
    const now = new Date()
    const writes: Write[] = []
    const write = (statement: BatchItem, weight = 200) => writes.push({ statement, weight })

    async function flush() {
      let batch: BatchItem[] = []
      let weight = 0
      const run = async () => {
        const [first, ...rest] = batch
        batch = []
        weight = 0
        if (first) await db.batch([first, ...rest])
      }
      try {
        for (const item of writes.splice(0)) {
          if (batch.length >= BATCH_STATEMENTS || weight + item.weight > BATCH_WEIGHT) await run()
          batch.push(item.statement)
          weight += item.weight
        }
        await run()
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw KansoError.conflict('The site changed during the import. Run the import again.')
        }
        throw error
      }
    }

    async function importSettings(
      entries: [string, unknown][],
      mediaIds: Map<string, number>,
      target: ImportReport,
      sink: WarningSink,
    ) {
      const [settingRows, pageRows] = await Promise.all([
        db.query.settings.findMany(),
        db.select({ id: pages.id, path: pages.path }).from(pages).where(isNull(pages.deletedAt)),
      ])
      const existing = new Map(settingRows.map((row) => [row.key, row.valueJson] as const))
      const pageIds = new Map(pageRows.map((row) => [row.path, row.id] as const))

      for (const [key, raw] of entries) {
        const label = `settings[${key}]`
        const schema = TRANSFERABLE.has(key) ? SETTINGS_SCHEMAS[key] : undefined
        if (!schema) {
          target.skipped += 1
          sink(
            key === SETTINGS_KEYS.starter || key === SETTINGS_KEYS.cache
              ? `${label}: belongs to the site it was exported from; not imported`
              : `${label}: unknown settings key`,
          )
          continue
        }
        const decoded = decodeSettingsValue(key, raw, mediaIds, pageIds, sink)
        const parsed = schema.safeParse(decoded)
        if (!parsed.success) {
          target.skipped += 1
          sink(`${label}: invalid value (${parsed.error.issues[0]?.message ?? 'schema mismatch'})`)
          continue
        }
        const current = existing.get(key)
        if (current !== undefined && sameJson(current, parsed.data)) {
          target.skipped += 1
          continue
        }
        write(
          db
            .insert(settings)
            .values({ key, valueJson: parsed.data })
            .onConflictDoUpdate({ target: settings.key, set: { valueJson: parsed.data } }),
          weigh({ value: parsed.data }),
        )
        if (current === undefined) target.created += 1
        else target.updated += 1
      }
    }

    const settingsEntries = Object.entries(bundle.settings ?? {})
    const wantsPosts = bundle.posts.length > 0
    const wantsPages = bundle.pages.length > 0
    // Cover/OG images, images inside sections and custom fields, settings.
    const referencesMedia = wantsPages || wantsPosts || settingsEntries.length > 0

    const [
      typeRows,
      tagRows,
      categoryRows,
      pageMeta,
      mediaRows,
      userRows,
      redirectRows,
      menuRows,
      formRows,
    ] = await Promise.all([
      db.query.postTypes.findMany(),
      bundle.tags.length > 0 || wantsPosts ? db.query.tags.findMany() : [],
      bundle.categories.length > 0 || wantsPosts ? db.query.categories.findMany() : [],
      wantsPages || bundle.postTypes.length > 0 || settingsEntries.length > 0
        ? db.select({ id: pages.id, path: pages.path }).from(pages).where(isNull(pages.deletedAt))
        : [],
      referencesMedia ? db.select({ id: media.id, r2Key: media.r2Key }).from(media) : [],
      bundle.posts.some((item) => item.author !== null)
        ? db.select({ id: users.id, slug: users.slug }).from(users)
        : [],
      bundle.redirects.length > 0 ? db.query.redirects.findMany() : [],
      bundle.menus.length > 0 ? db.query.menus.findMany() : [],
      bundle.forms.length > 0 ? db.query.forms.findMany() : [],
    ])

    const mediaIdByKey = new Map(mediaRows.map((row) => [row.r2Key, row.id]))
    const resolveMedia = (key: string | null, owner: string): number | null => {
      if (key === null) return null
      const id = mediaIdByKey.get(key)
      if (id === undefined) {
        warn(`${owner}: media "${key}" is not in this site`)
        return null
      }
      return id
    }

    // ---------------------------------------------------------------- post types
    const typeBySlug = new Map(typeRows.map((row) => [row.slug, row]))
    const typeSlugById = new Map(typeRows.map((row) => [row.id, row.slug]))
    /** Every post type that exists once the import is through, with its final definition. */
    const finalTypes = new Map<
      string,
      { hasCategories: boolean; hasTags: boolean; fields: SectionField[] | null }
    >(
      typeRows.map((row) => [
        row.slug,
        { hasCategories: row.hasCategories, hasTags: row.hasTags, fields: row.fieldsJson },
      ]),
    )
    const topLevelPaths = new Set(
      pageMeta.filter((row) => !row.path.includes('/')).map((row) => row.path),
    )
    const typeRef = (slug: string): number | SQL =>
      typeBySlug.get(slug)?.id ?? sql`(select id from post_types where slug = ${slug})`

    const seenTypes = new Set<string>()
    for (const item of bundle.postTypes) {
      const label = `postTypes[${item.slug}]`
      if (seenTypes.has(item.slug)) {
        skip(label, 'listed more than once')
        continue
      }
      seenTypes.add(item.slug)
      const existing = typeBySlug.get(item.slug)
      const definition = {
        name: item.name,
        description: item.description,
        hasCategories: item.hasCategories,
        hasTags: item.hasTags,
        noindex: item.noindex,
        fields: item.fields,
        sortOrder: item.sortOrder,
      }
      if (!existing) {
        if (isReservedSlug(item.slug)) {
          skip(label, 'slug is reserved')
          continue
        }
        if (topLevelPaths.has(item.slug)) {
          skip(label, 'slug is used by a page')
          continue
        }
        const values = postTypeInsertValues({ ...item, fields: item.fields ?? undefined })
        write(db.insert(postTypes).values(values), weigh(values))
        report.created += 1
      } else if (
        sameJson(
          {
            name: existing.name,
            description: existing.description,
            hasCategories: existing.hasCategories,
            hasTags: existing.hasTags,
            noindex: existing.noindex,
            fields: existing.fieldsJson,
            sortOrder: existing.sortOrder,
          },
          definition,
        )
      ) {
        report.skipped += 1
      } else {
        const values = {
          name: item.name,
          description: item.description,
          hasCategories: item.hasCategories,
          hasTags: item.hasTags,
          noindex: item.noindex,
          fieldsJson: item.fields,
          sortOrder: item.sortOrder,
          updatedAt: now,
        }
        write(db.update(postTypes).set(values).where(eq(postTypes.id, existing.id)), weigh(values))
        report.updated += 1
      }
      finalTypes.set(item.slug, {
        hasCategories: item.hasCategories,
        hasTags: item.hasTags,
        fields: item.fields,
      })
    }

    // ---------------------------------------------------------------- tags
    const tagBySlug = new Map(tagRows.map((row) => [row.slug, row]))
    const finalTags = new Set(tagBySlug.keys())
    const newTags: { slug: string; name: string }[] = []
    for (const item of bundle.tags) {
      const existing = tagBySlug.get(item.slug)
      if (finalTags.has(item.slug) && !existing) {
        skip(`tags[${item.slug}]`, 'listed more than once')
      } else if (!existing) {
        newTags.push({ slug: item.slug, name: item.name })
        finalTags.add(item.slug)
        report.created += 1
      } else if (existing.name === item.name) {
        report.skipped += 1
      } else {
        write(db.update(tags).set({ name: item.name }).where(eq(tags.id, existing.id)))
        tagBySlug.set(item.slug, { ...existing, name: item.name })
        report.updated += 1
      }
    }
    for (const rows of chunked(newTags, ROWS_PER_INSERT)) {
      write(db.insert(tags).values(rows), 200 * rows.length)
    }

    // ---------------------------------------------------------------- categories
    const categoryKey = (typeSlug: string, slug: string) => `${typeSlug}/${slug}`
    const categoryById = new Map(categoryRows.map((row) => [row.id, row]))
    const categorySlugById = new Map(categoryRows.map((row) => [row.id, row.slug]))
    const existingCategories = new Map(
      categoryRows.flatMap((row) => {
        const typeSlug = typeSlugById.get(row.postTypeId)
        return typeSlug ? [[categoryKey(typeSlug, row.slug), row] as const] : []
      }),
    )
    const finalCategories = new Set(existingCategories.keys())
    /** key → parent key (or null) as it will stand after the import; used to refuse cycles. */
    const parentOf = new Map<string, string | null>()
    for (const [key, row] of existingCategories) {
      const parent = row.parentId === null ? undefined : categoryById.get(row.parentId)
      const typeSlug = typeSlugById.get(row.postTypeId)
      parentOf.set(key, parent && typeSlug ? categoryKey(typeSlug, parent.slug) : null)
    }
    const categoryRef = (typeSlug: string, slug: string): number | SQL =>
      existingCategories.get(categoryKey(typeSlug, slug))?.id ??
      sql`(select id from categories where post_type_id = ${typeRef(typeSlug)} and slug = ${slug})`

    const touchedCategories = new Set<string>()
    const createdCategories = new Set<string>()
    const acceptedCategories: ExportBundle['categories'] = []
    const newCategoryRows: {
      postTypeId: number | SQL
      slug: string
      name: string
      sortOrder: number
    }[] = []
    for (const item of bundle.categories) {
      const label = `categories[${item.postType}/${item.slug}]`
      const key = categoryKey(item.postType, item.slug)
      if (!finalTypes.has(item.postType)) {
        warn(`${label}: post type "${item.postType}" does not exist`)
        continue
      }
      const existing = existingCategories.get(key)
      if (!existing) {
        if (finalCategories.has(key)) {
          warn(`${label}: listed more than once`)
          continue
        }
        newCategoryRows.push({
          postTypeId: typeRef(item.postType),
          slug: item.slug,
          name: item.name,
          sortOrder: item.sortOrder,
        })
        finalCategories.add(key)
        createdCategories.add(key)
        parentOf.set(key, null)
      } else if (existing.name !== item.name || existing.sortOrder !== item.sortOrder) {
        write(
          db
            .update(categories)
            .set({ name: item.name, sortOrder: item.sortOrder })
            .where(eq(categories.id, existing.id)),
        )
        touchedCategories.add(key)
      }
      acceptedCategories.push(item)
    }
    for (const rows of chunked(newCategoryRows, ROWS_PER_INSERT)) {
      write(db.insert(categories).values(rows), 200 * rows.length)
    }
    // Parent links go second: a parent may be anywhere in the bundle.
    for (const item of acceptedCategories) {
      const label = `categories[${item.postType}/${item.slug}]`
      const key = categoryKey(item.postType, item.slug)
      let parentKey: string | null = null
      if (item.parent !== null) {
        parentKey = categoryKey(item.postType, item.parent)
        if (!finalCategories.has(parentKey)) {
          warn(`${label}: parent category "${item.parent}" does not exist`)
          parentKey = null
        }
      }
      if ((parentOf.get(key) ?? null) === parentKey) continue
      if (parentKey !== null) {
        let cursor: string | null = parentKey
        const visited = new Set<string>()
        while (cursor !== null && cursor !== key && !visited.has(cursor)) {
          visited.add(cursor)
          cursor = parentOf.get(cursor) ?? null
        }
        if (cursor !== null) {
          warn(`${label}: parent "${item.parent}" would make the category its own ancestor`)
          continue
        }
      }
      parentOf.set(key, parentKey)
      write(
        db
          .update(categories)
          .set({
            parentId:
              parentKey === null || item.parent === null
                ? null
                : categoryRef(item.postType, item.parent),
          })
          .where(
            and(eq(categories.postTypeId, typeRef(item.postType)), eq(categories.slug, item.slug)),
          ),
      )
      if (!createdCategories.has(key)) touchedCategories.add(key)
    }
    report.created += createdCategories.size
    report.updated += touchedCategories.size
    // Unchanged rows, failures and unresolved post types all land in `skipped`.
    report.skipped += bundle.categories.length - createdCategories.size - touchedCategories.size

    // ---------------------------------------------------------------- pages
    const pageIdByPath = new Map(pageMeta.map((row) => [row.path, row.id]))
    const bundlePagePaths = sortedUnique(bundle.pages.map((item) => item.path)).filter((path) =>
      pageIdByPath.has(path),
    )
    const existingPages = new Map(
      (
        await Promise.all(
          chunked(bundlePagePaths, IN_LIST).map((paths) =>
            db.query.pages.findMany({
              where: and(isNull(pages.deletedAt), inArray(pages.path, paths)),
              columns: { searchText: false, bodyHtml: false },
            }),
          ),
        )
      )
        .flat()
        .map((row) => [row.path, row] as const),
    )
    const importedPaths = new Set<string>()
    for (const item of sortByPathDepth(bundle.pages)) {
      const label = `pages[${item.path}]`
      const { slug, parentPath } = pageIdentity(item.path)
      if (importedPaths.has(item.path)) {
        skip(label, 'listed more than once')
        continue
      }
      const existing = existingPages.get(item.path)
      if (!existing) {
        if (
          parentPath !== null &&
          !pageIdByPath.has(parentPath) &&
          !importedPaths.has(parentPath)
        ) {
          skip(label, `parent page "${parentPath}" does not exist`)
          continue
        }
        if (parentPath === null && isReservedSlug(slug)) {
          skip(label, 'slug is reserved')
          continue
        }
        if (parentPath === null && finalTypes.has(slug)) {
          skip(label, 'slug is used by a post type')
          continue
        }
      }
      const ogMediaId = resolveMedia(item.ogMedia, label)
      const sections =
        item.sections?.map((section) => ({
          ...section,
          settings: decodeImageFields(
            context.sectionFields?.(section.type),
            section.settings,
            resolveMedia,
            label,
            warn,
          ),
        })) ?? null
      importedPaths.add(item.path)

      if (!existing) {
        const values = pageInsertValues(
          {
            slug,
            sortOrder: item.sortOrder,
            sections,
            title: item.title,
            bodyJson: item.bodyJson ?? undefined,
            excerpt: item.excerpt,
            status: item.status,
            publishedAt: item.publishedAt,
            seoTitle: item.seoTitle,
            seoDescription: item.seoDescription,
            noindex: item.noindex,
            canonicalUrl: item.canonicalUrl,
            ogMediaId,
          },
          item.path,
          context,
          now,
        )
        const parentId =
          parentPath === null
            ? null
            : (pageIdByPath.get(parentPath) ??
              sql`(select id from pages where path = ${parentPath} and deleted_at is null)`)
        write(db.insert(pages).values({ ...values, parentId }), weigh(values))
        report.created += 1
        continue
      }

      const desiredPublishedAt =
        item.publishedAt ??
        (item.status === 'published' ? (toIso(existing.publishedAt) ?? now.toISOString()) : null)
      const desired = {
        title: item.title,
        bodyJson: item.bodyJson ?? EMPTY_DOCUMENT,
        sections,
        excerpt: item.excerpt?.trim() ? item.excerpt : null,
        status: item.status,
        publishedAt: desiredPublishedAt === null ? null : toIso(desiredPublishedAt),
        sortOrder: item.sortOrder,
        seoTitle: item.seoTitle,
        seoDescription: item.seoDescription,
        noindex: item.noindex,
        canonicalUrl: item.canonicalUrl,
        ogMediaId,
      }
      const current = {
        title: existing.title,
        bodyJson: existing.bodyJson ?? EMPTY_DOCUMENT,
        sections: existing.sectionsJson,
        excerpt: existing.excerpt,
        status: existing.status,
        publishedAt: toIso(existing.publishedAt),
        sortOrder: existing.sortOrder,
        seoTitle: existing.seoTitle,
        seoDescription: existing.seoDescription,
        noindex: existing.noindex,
        canonicalUrl: existing.canonicalUrl,
        ogMediaId: existing.ogMediaId,
      }
      if (sameJson(current, desired)) {
        report.skipped += 1
        continue
      }
      const rendered = pageInsertValues(
        {
          slug,
          sortOrder: item.sortOrder,
          sections,
          title: item.title,
          bodyJson: item.bodyJson ?? undefined,
          excerpt: item.excerpt,
          status: item.status,
          publishedAt: desiredPublishedAt,
          seoTitle: item.seoTitle,
          seoDescription: item.seoDescription,
          noindex: item.noindex,
          canonicalUrl: item.canonicalUrl,
          ogMediaId,
        },
        item.path,
        context,
        now,
      )
      // Identity (slug, path, parent) is what the row was matched by and never changes here.
      const { slug: _slug, path: _path, parentId: _parentId, ...changes } = rendered
      const snapshot: PageRevisionSnapshot = {
        title: existing.title,
        slug: existing.slug,
        parentId: existing.parentId,
        sortOrder: existing.sortOrder,
        bodyJson: existing.bodyJson ?? EMPTY_DOCUMENT,
        sections: existing.sectionsJson,
        excerpt: existing.excerpt,
        status: existing.status,
        publishedAt: toIso(existing.publishedAt),
        seoTitle: existing.seoTitle,
        seoDescription: existing.seoDescription,
        ogMediaId: existing.ogMediaId,
        noindex: existing.noindex,
        canonicalUrl: existing.canonicalUrl,
      }
      write(
        db
          .update(pages)
          .set({ ...changes, updatedAt: now })
          .where(eq(pages.id, existing.id)),
        weigh(changes),
      )
      for (const statement of revisions.recordStatements(
        'page',
        existing.id,
        snapshot,
        context.userId,
      )) {
        write(statement, weigh({ snapshot }))
      }
      report.updated += 1
    }

    // ---------------------------------------------------------------- posts
    const userIdBySlug = new Map(
      userRows.flatMap((row) => (row.slug === null ? [] : [[row.slug, row.id] as const])),
    )
    const bundlePostSlugs = sortedUnique(
      bundle.posts.filter((item) => typeBySlug.has(item.postType)).map((item) => item.slug),
    )
    const existingPostRows = (
      await Promise.all(
        chunked(bundlePostSlugs, IN_LIST).map((slugs) =>
          db.query.posts.findMany({
            where: and(isNull(posts.deletedAt), inArray(posts.slug, slugs)),
            columns: { searchText: false, bodyHtml: false },
          }),
        ),
      )
    ).flat()
    const postKey = (typeSlug: string, slug: string) => `${typeSlug}/${slug}`
    const existingPosts = new Map(
      existingPostRows.flatMap((row) => {
        const typeSlug = typeSlugById.get(row.postTypeId)
        return typeSlug ? [[postKey(typeSlug, row.slug), row] as const] : []
      }),
    )
    const wanted = new Set(bundle.posts.map((item) => postKey(item.postType, item.slug)))
    const matchedPostIds = [...existingPosts]
      .filter(([key]) => wanted.has(key))
      .map(([, row]) => row.id)
    const [categoryLinkRows, tagLinkRows] = await Promise.all([
      Promise.all(
        chunked(matchedPostIds, IN_LIST).map((ids) =>
          db.select().from(postCategories).where(inArray(postCategories.postId, ids)),
        ),
      ),
      Promise.all(
        chunked(matchedPostIds, IN_LIST).map((ids) =>
          db.select().from(postTags).where(inArray(postTags.postId, ids)),
        ),
      ),
    ])
    const tagSlugById = new Map(tagRows.map((row) => [row.id, row.slug]))
    const categoryIdsOf = new Map<number, number[]>()
    for (const link of categoryLinkRows.flat()) {
      categoryIdsOf.set(link.postId, [...(categoryIdsOf.get(link.postId) ?? []), link.categoryId])
    }
    const tagIdsOf = new Map<number, number[]>()
    for (const link of tagLinkRows.flat()) {
      tagIdsOf.set(link.postId, [...(tagIdsOf.get(link.postId) ?? []), link.tagId])
    }

    /** Link a post — addressed by type and slug, so it may be one inserted above — to its terms. */
    const postWhere = (typeSlug: string, slug: string) =>
      sql`p.post_type_id = ${typeRef(typeSlug)} and p.slug = ${slug} and p.deleted_at is null`
    const linkCategories = (typeSlug: string, slug: string, categorySlugs: string[]) =>
      db
        .insert(postCategories)
        .select(
          sql`select p.id, c.id from posts p join categories c on c.post_type_id = p.post_type_id where ${postWhere(typeSlug, slug)} and c.slug in ${categorySlugs}`,
        )
    const linkTags = (typeSlug: string, slug: string, tagSlugs: string[]) =>
      db
        .insert(postTags)
        .select(
          sql`select p.id, t.id from posts p join tags t on t.slug in ${tagSlugs} where ${postWhere(typeSlug, slug)}`,
        )

    const seenPosts = new Set<string>()
    for (const item of bundle.posts) {
      const label = `posts[${item.postType}/${item.slug}]`
      const key = postKey(item.postType, item.slug)
      const type = finalTypes.get(item.postType)
      if (!type) {
        skip(label, `post type "${item.postType}" does not exist`)
        continue
      }
      if (seenPosts.has(key)) {
        skip(label, 'listed more than once')
        continue
      }
      seenPosts.add(key)

      let categorySlugs: string[] = []
      if (item.categories.length > 0 && !type.hasCategories) {
        warn(`${label}: post type "${item.postType}" does not use categories`)
      } else {
        categorySlugs = sortedUnique(
          item.categories.filter((slug) => {
            const known = finalCategories.has(categoryKey(item.postType, slug))
            if (!known) warn(`${label}: category "${slug}" does not exist`)
            return known
          }),
        )
      }
      let tagSlugs: string[] = []
      if (item.tags.length > 0 && !type.hasTags) {
        warn(`${label}: post type "${item.postType}" does not use tags`)
      } else {
        tagSlugs = sortedUnique(
          item.tags.filter((slug) => {
            const known = finalTags.has(slug)
            if (!known) warn(`${label}: tag "${slug}" does not exist`)
            return known
          }),
        )
      }
      let authorId: number | null = null
      if (item.author !== null) {
        authorId = userIdBySlug.get(item.author) ?? null
        if (authorId === null) warn(`${label}: author "${item.author}" does not exist`)
      }
      const coverMediaId = resolveMedia(item.coverMedia, label)
      const ogMediaId = resolveMedia(item.ogMedia, label)

      let fields: ReturnType<typeof parsePostFields>
      try {
        fields = parsePostFields(
          type.fields,
          item.fields === null
            ? undefined
            : decodeImageFields(type.fields, item.fields, resolveMedia, label, warn),
        )
      } catch (error) {
        skip(label, error instanceof Error ? error.message : 'invalid custom fields')
        continue
      }

      const existing = existingPosts.get(key)
      const content = {
        slug: item.slug,
        title: item.title,
        bodyJson: item.bodyJson ?? undefined,
        excerpt: item.excerpt,
        status: item.status,
        pinned: item.pinned,
        coverMediaId,
        ogMediaId,
        seoTitle: item.seoTitle,
        seoDescription: item.seoDescription,
        noindex: item.noindex,
        canonicalUrl: item.canonicalUrl,
      }
      if (!existing) {
        const values = postInsertValues(
          { ...content, publishedAt: item.publishedAt },
          { allowRawHtml: context.allowRawHtml, authorId },
          now,
        )
        write(
          db
            .insert(posts)
            .values({ postTypeId: typeRef(item.postType), fieldsJson: fields, ...values }),
          weigh(values),
        )
        if (categorySlugs.length > 0) {
          write(linkCategories(item.postType, item.slug, categorySlugs))
        }
        if (tagSlugs.length > 0) write(linkTags(item.postType, item.slug, tagSlugs))
        report.created += 1
        continue
      }

      const desiredPublishedAt =
        item.publishedAt ??
        (item.status === 'published' ? (toIso(existing.publishedAt) ?? now.toISOString()) : null)
      const currentCategoryIds = categoryIdsOf.get(existing.id) ?? []
      const currentTagIds = tagIdsOf.get(existing.id) ?? []
      const currentCategorySlugs = sortedUnique(
        currentCategoryIds.flatMap((id) => categorySlugById.get(id) ?? []),
      )
      const currentTagSlugs = sortedUnique(currentTagIds.flatMap((id) => tagSlugById.get(id) ?? []))
      const desired = {
        title: item.title,
        bodyJson: item.bodyJson ?? EMPTY_DOCUMENT,
        excerpt: item.excerpt?.trim() ? item.excerpt : null,
        status: item.status,
        publishedAt: desiredPublishedAt === null ? null : toIso(desiredPublishedAt),
        pinned: item.pinned,
        fields,
        coverMediaId,
        ogMediaId,
        authorId,
        categories: categorySlugs,
        tags: tagSlugs,
        seoTitle: item.seoTitle,
        seoDescription: item.seoDescription,
        noindex: item.noindex,
        canonicalUrl: item.canonicalUrl,
      }
      const current = {
        title: existing.title,
        bodyJson: existing.bodyJson ?? EMPTY_DOCUMENT,
        excerpt: existing.excerpt,
        status: existing.status,
        publishedAt: toIso(existing.publishedAt),
        pinned: existing.pinned,
        fields: existing.fieldsJson,
        coverMediaId: existing.coverMediaId,
        ogMediaId: existing.ogMediaId,
        authorId: existing.authorId,
        categories: currentCategorySlugs,
        tags: currentTagSlugs,
        seoTitle: existing.seoTitle,
        seoDescription: existing.seoDescription,
        noindex: existing.noindex,
        canonicalUrl: existing.canonicalUrl,
      }
      if (sameJson(current, desired)) {
        report.skipped += 1
        continue
      }
      const rendered = postInsertValues(
        { ...content, publishedAt: desiredPublishedAt },
        { allowRawHtml: context.allowRawHtml, authorId },
        now,
      )
      const { slug: _slug, ...changes } = rendered
      const snapshot: PostRevisionSnapshot = {
        title: existing.title,
        slug: existing.slug,
        bodyJson: existing.bodyJson ?? EMPTY_DOCUMENT,
        excerpt: existing.excerpt,
        status: existing.status,
        publishedAt: toIso(existing.publishedAt),
        coverMediaId: existing.coverMediaId,
        pinned: existing.pinned,
        categoryIds: [...currentCategoryIds].sort((a, b) => a - b),
        tagIds: [...currentTagIds].sort((a, b) => a - b),
        seoTitle: existing.seoTitle,
        seoDescription: existing.seoDescription,
        ogMediaId: existing.ogMediaId,
        noindex: existing.noindex,
        canonicalUrl: existing.canonicalUrl,
        fields: existing.fieldsJson ?? {},
      }
      write(
        db
          .update(posts)
          .set({ ...changes, fieldsJson: fields, updatedAt: now })
          .where(eq(posts.id, existing.id)),
        weigh(changes),
      )
      if (!sameJson(currentCategorySlugs, categorySlugs)) {
        write(db.delete(postCategories).where(eq(postCategories.postId, existing.id)))
        if (categorySlugs.length > 0) {
          write(linkCategories(item.postType, item.slug, categorySlugs))
        }
      }
      if (!sameJson(currentTagSlugs, tagSlugs)) {
        write(db.delete(postTags).where(eq(postTags.postId, existing.id)))
        if (tagSlugs.length > 0) write(linkTags(item.postType, item.slug, tagSlugs))
      }
      for (const statement of revisions.recordStatements(
        'post',
        existing.id,
        snapshot,
        context.userId,
      )) {
        write(statement, weigh({ snapshot }))
      }
      report.updated += 1
    }

    // ---------------------------------------------------------------- redirects
    const redirectByPath = new Map(redirectRows.map((row) => [row.fromPath, row]))
    const seenRedirects = new Set<string>()
    for (const item of bundle.redirects) {
      const label = `redirects[${item.fromPath}]`
      const parsed = createRedirectSchema.safeParse(item)
      if (!parsed.success) {
        skip(label, parsed.error.issues[0]?.message ?? 'invalid redirect')
        continue
      }
      const input = parsed.data
      if (seenRedirects.has(input.fromPath)) {
        skip(label, 'listed more than once')
        continue
      }
      seenRedirects.add(input.fromPath)
      const existing = redirectByPath.get(input.fromPath)
      if (!existing) {
        write(db.insert(redirects).values(input))
        report.created += 1
      } else if (existing.to === input.to && existing.status === input.status) {
        report.skipped += 1
      } else {
        write(
          db
            .update(redirects)
            .set({ to: input.to, status: input.status, updatedAt: now })
            .where(eq(redirects.id, existing.id)),
        )
        report.updated += 1
      }
    }

    // ---------------------------------------------------------------- menus
    const menuBySlug = new Map(menuRows.map((row) => [row.slug, row]))
    const seenMenus = new Set<string>()
    for (const item of bundle.menus) {
      const label = `menus[${item.slug}]`
      if (seenMenus.has(item.slug)) {
        skip(label, 'listed more than once')
        continue
      }
      seenMenus.add(item.slug)
      const existing = menuBySlug.get(item.slug)
      if (!existing) {
        const values = { slug: item.slug, name: item.name, itemsJson: item.items }
        write(db.insert(menus).values(values), weigh(values))
        report.created += 1
      } else if (existing.name === item.name && sameJson(existing.itemsJson, item.items)) {
        report.skipped += 1
      } else {
        const values = { name: item.name, itemsJson: item.items, updatedAt: now }
        write(db.update(menus).set(values).where(eq(menus.id, existing.id)), weigh(values))
        report.updated += 1
      }
    }

    // ---------------------------------------------------------------- forms
    const formBySlug = new Map(formRows.map((row) => [row.slug, row]))
    const seenForms = new Set<string>()
    for (const item of bundle.forms) {
      const label = `forms[${item.slug}]`
      if (seenForms.has(item.slug)) {
        skip(label, 'listed more than once')
        continue
      }
      seenForms.add(item.slug)
      let turnstile = item.turnstile
      if (turnstile && !context.turnstileAvailable) {
        warn(`${label}: Turnstile is not configured on this site; imported without it`)
        turnstile = false
      }
      const values = formInsertValues({ ...item, turnstile })
      const existing = formBySlug.get(item.slug)
      if (!existing) {
        write(db.insert(forms).values(values), weigh(values))
        report.created += 1
      } else if (
        sameJson(
          {
            name: existing.name,
            fieldsJson: existing.fieldsJson,
            notifyTo: existing.notifyTo,
            successMessage: existing.successMessage,
            redirectUrl: existing.redirectUrl,
            turnstile: existing.turnstile,
          },
          {
            name: values.name,
            fieldsJson: values.fieldsJson,
            notifyTo: values.notifyTo,
            successMessage: values.successMessage,
            redirectUrl: values.redirectUrl,
            turnstile: values.turnstile,
          },
        )
      ) {
        report.skipped += 1
      } else {
        const { slug: _slug, ...changes } = values
        write(
          db
            .update(forms)
            .set({ ...changes, updatedAt: now })
            .where(eq(forms.id, existing.id)),
          weigh(changes),
        )
        report.updated += 1
      }
    }

    await flush()

    // ---------------------------------------------------------------- settings
    // Last, and after the content is written: `notFoundPageId` may point at a
    // page this very import created.
    if (settingsEntries.length > 0) {
      if (!context.canImportSettings) {
        report.skipped += settingsEntries.length
        warn('settings: only an administrator signed in to the admin can import settings; skipped')
      } else {
        await importSettings(settingsEntries, mediaIdByKey, report, warn)
        await flush()
      }
    }

    return report
  }

  return { export: exportBundle, import: importBundle }
}

function encodeSettingsValue(
  key: string,
  value: unknown,
  mediaById: Map<number, { r2Key: string }>,
  pageById: Map<number, { path: string }>,
): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const record = { ...(value as Record<string, unknown>) }
  for (const field of SETTINGS_MEDIA_FIELDS[key] ?? []) {
    const id = record[field]
    if (typeof id === 'number') {
      record[field] = { $ref: 'media', key: mediaById.get(id)?.r2Key ?? null }
    }
  }
  for (const field of SETTINGS_PAGE_FIELDS[key] ?? []) {
    const id = record[field]
    if (typeof id === 'number') {
      record[field] = { $ref: 'page', path: pageById.get(id)?.path ?? null }
    }
  }
  return record
}

function decodeSettingsValue(
  key: string,
  value: unknown,
  mediaIdByKey: Map<string, number>,
  pageIdByPath: Map<string, number>,
  warn: WarningSink,
): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const record = { ...(value as Record<string, unknown>) }
  for (const field of SETTINGS_MEDIA_FIELDS[key] ?? []) {
    const ref = record[field]
    if (ref !== null && typeof ref === 'object' && !Array.isArray(ref)) {
      const mediaKey = (ref as { key?: unknown }).key
      record[field] = typeof mediaKey === 'string' ? (mediaIdByKey.get(mediaKey) ?? null) : null
      if (typeof mediaKey === 'string' && record[field] === null) {
        warn(`settings[${key}].${field}: media "${mediaKey}" missing`)
      }
    }
  }
  for (const field of SETTINGS_PAGE_FIELDS[key] ?? []) {
    const ref = record[field]
    if (ref !== null && typeof ref === 'object' && !Array.isArray(ref)) {
      const path = (ref as { path?: unknown }).path
      record[field] = typeof path === 'string' ? (pageIdByPath.get(path) ?? null) : null
      if (typeof path === 'string' && record[field] === null) {
        warn(`settings[${key}].${field}: page "${path}" missing`)
      }
    }
  }
  return record
}

export type TransferService = ReturnType<typeof transferService>
