import {
  cacheSettingsSchema,
  EXPORT_BUNDLE_VERSION,
  type ExportBundle,
  formsSettingsSchema,
  type ImportReport,
  organizationSettingsSchema,
  SETTINGS_KEYS,
  siteSettingsSchema,
  starterManifestSchema,
  themeSettingsSchema,
} from '@kanso/shared'
import { asc, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import { EMPTY_DOCUMENT } from '../content/index.ts'
import type { Db } from '../db/client.ts'
import {
  categories,
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
import { menusService } from './menus.ts'
import { pagesService } from './pages.ts'
import { postTypesService } from './post-types.ts'
import { parsePostFields, postsService } from './posts.ts'
import { redirectsService } from './redirects.ts'
import { taxonomiesService } from './taxonomies.ts'

type ImportContext = { allowRawHtml: boolean; userId: number | null }
type WarningSink = (message: string) => void

/** Settings object fields holding a `media.id`; exported as `{ $ref: 'media', key }`. */
const SETTINGS_MEDIA_FIELDS: Record<string, readonly string[]> = {
  [SETTINGS_KEYS.site]: ['logoMediaId', 'ogImageMediaId', 'faviconMediaId'],
  [SETTINGS_KEYS.organization]: ['logoMediaId'],
}
/** Settings object fields holding a `pages.id`; exported as `{ $ref: 'page', path }`. */
const SETTINGS_PAGE_FIELDS: Record<string, readonly string[]> = {
  [SETTINGS_KEYS.site]: ['notFoundPageId'],
}
const SETTINGS_SCHEMAS: Record<string, z.ZodType> = {
  [SETTINGS_KEYS.site]: siteSettingsSchema,
  [SETTINGS_KEYS.organization]: organizationSettingsSchema,
  [SETTINGS_KEYS.forms]: formsSettingsSchema,
  [SETTINGS_KEYS.theme]: themeSettingsSchema,
  [SETTINGS_KEYS.cache]: cacheSettingsSchema,
  [SETTINGS_KEYS.starter]: starterManifestSchema,
}

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

export function transferService(db: Db) {
  const postTypesApi = postTypesService(db)
  const taxonomies = taxonomiesService(db)
  const pagesApi = pagesService(db)
  const postsApi = postsService(db)
  const redirectsApi = redirectsService(db)
  const menusApi = menusService(db)

  async function exportBundle(options: { settings: boolean }): Promise<ExportBundle> {
    const [
      typeRows,
      categoryRows,
      tagRows,
      mediaRows,
      pageRows,
      postRows,
      redirectRows,
      menuRows,
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
        sections: row.sectionsJson,
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
        fields: row.fieldsJson,
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
    }

    if (options.settings) {
      bundle.settings = Object.fromEntries(
        settingRows.map((row) => [
          row.key,
          encodeSettingsValue(row.key, row.valueJson, mediaById, pageById),
        ]),
      )
    }
    return bundle
  }

  async function importBundle(bundle: ExportBundle, context: ImportContext): Promise<ImportReport> {
    const report = { created: 0, updated: 0, skipped: 0, warnings: [] as string[] }
    const warn: WarningSink = (message) => report.warnings.push(message)
    const failed = (label: string, error: unknown) => {
      report.skipped += 1
      warn(`${label}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }

    const [mediaRows, userRows] = await Promise.all([
      db.select({ id: media.id, r2Key: media.r2Key }).from(media),
      db.select({ id: users.id, slug: users.slug }).from(users),
    ])
    const mediaIdByKey = new Map(mediaRows.map((row) => [row.r2Key, row.id]))
    const userIdBySlug = new Map(
      userRows.flatMap((row) => (row.slug === null ? [] : [[row.slug, row.id] as const])),
    )
    const resolveMedia = (key: string | null, owner: string): number | null => {
      if (key === null) return null
      const id = mediaIdByKey.get(key)
      if (id === undefined) {
        warn(`${owner}: media "${key}" is not in this site`)
        return null
      }
      return id
    }

    if (bundle.settings) await importSettings(bundle.settings, report, warn)

    // Post types first — every category/post key resolves through them.
    const typeIdBySlug = new Map(
      (await db.query.postTypes.findMany()).map((row) => [row.slug, row.id]),
    )
    for (const item of bundle.postTypes) {
      const label = `postTypes[${item.slug}]`
      const existing = await db.query.postTypes.findFirst({
        where: eq(postTypes.slug, item.slug),
      })
      try {
        if (!existing) {
          const created = await postTypesApi.create({ ...item, fields: item.fields ?? undefined })
          typeIdBySlug.set(item.slug, created.id)
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
            {
              name: item.name,
              description: item.description,
              hasCategories: item.hasCategories,
              hasTags: item.hasTags,
              noindex: item.noindex,
              fields: item.fields,
              sortOrder: item.sortOrder,
            },
          )
        ) {
          report.skipped += 1
        } else {
          await postTypesApi.update(existing.id, { ...item, fields: item.fields ?? undefined })
          report.updated += 1
        }
      } catch (error) {
        failed(label, error)
      }
    }

    // Tags are global; upsert before posts so post tag links resolve.
    const tagIdBySlug = new Map((await db.query.tags.findMany()).map((row) => [row.slug, row.id]))
    for (const item of bundle.tags) {
      const existing = tagIdBySlug.get(item.slug)
      try {
        if (existing === undefined) {
          const created = await taxonomies.createTag(item)
          tagIdBySlug.set(item.slug, created.id)
          report.created += 1
        } else {
          const current = await db.query.tags.findFirst({ where: eq(tags.id, existing) })
          if (current?.name === item.name) {
            report.skipped += 1
          } else {
            await taxonomies.updateTag(existing, { name: item.name })
            report.updated += 1
          }
        }
      } catch (error) {
        failed(`tags[${item.slug}]`, error)
      }
    }

    // Categories upsert in two passes: rows first, parent links after every
    // slug exists (bundle order is not a topological order).
    const categoryRows = await db.query.categories.findMany()
    const categoryIdByKey = new Map<string, number>(
      categoryRows.map((row) => [`${row.postTypeId}/${row.slug}`, row.id] as const),
    )
    const categoryById = new Map(categoryRows.map((row) => [row.id, row]))
    const dirtyCategories = new Set<number>()
    const createdCategoryIds = new Set<number>()
    let categoriesCreated = 0
    for (const item of bundle.categories) {
      const label = `categories[${item.postType}/${item.slug}]`
      const postTypeId = typeIdBySlug.get(item.postType)
      if (postTypeId === undefined) {
        warn(`${label}: post type "${item.postType}" does not exist`)
        continue
      }
      const key = `${postTypeId}/${item.slug}`
      const existingId = categoryIdByKey.get(key)
      try {
        if (existingId === undefined) {
          const created = await taxonomies.createCategory(postTypeId, {
            slug: item.slug,
            name: item.name,
            sortOrder: item.sortOrder,
          })
          categoryIdByKey.set(key, created.id)
          categoryById.set(created.id, created)
          createdCategoryIds.add(created.id)
          categoriesCreated += 1
        } else {
          const current = categoryById.get(existingId)
          if (current && (current.name !== item.name || current.sortOrder !== item.sortOrder)) {
            await taxonomies.updateCategory(postTypeId, existingId, {
              name: item.name,
              sortOrder: item.sortOrder,
            })
            dirtyCategories.add(existingId)
            categoryById.set(existingId, {
              ...current,
              name: item.name,
              sortOrder: item.sortOrder,
            })
          }
        }
      } catch (error) {
        warn(`${label}: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
    }
    for (const item of bundle.categories) {
      const postTypeId = typeIdBySlug.get(item.postType)
      const id =
        postTypeId === undefined ? undefined : categoryIdByKey.get(`${postTypeId}/${item.slug}`)
      if (id === undefined || postTypeId === undefined) continue
      const label = `categories[${item.postType}/${item.slug}]`
      let parentId: number | null = null
      if (item.parent !== null) {
        parentId = categoryIdByKey.get(`${postTypeId}/${item.parent}`) ?? null
        if (parentId === null) {
          warn(`${label}: parent category "${item.parent}" does not exist`)
        }
      }
      const current = categoryById.get(id)
      if (!current || current.parentId === parentId) continue
      try {
        await taxonomies.updateCategory(postTypeId, id, { parentId })
        if (!createdCategoryIds.has(id)) dirtyCategories.add(id)
        categoryById.set(id, { ...current, parentId })
      } catch (error) {
        warn(`${label}: ${error instanceof Error ? error.message : 'parent update failed'}`)
      }
    }
    report.created += categoriesCreated
    report.updated += dirtyCategories.size
    // Unchanged rows, failures and unresolved post types all land in `skipped`.
    report.skipped += bundle.categories.length - categoriesCreated - dirtyCategories.size

    // Pages upsert by path; parents must exist (bundle is depth-sorted).
    const pageRows = await db.query.pages.findMany({
      where: isNull(pages.deletedAt),
      columns: { searchText: false },
    })
    const pageByPath = new Map(pageRows.map((row) => [row.path, row]))
    const pageIdByPath = new Map(pageRows.map((row) => [row.path, row.id]))
    for (const item of sortByPathDepth(bundle.pages)) {
      const label = `pages[${item.path}]`
      const { slug, parentPath } = pageIdentity(item.path)
      let parentId: number | null = null
      if (parentPath !== null) {
        parentId = pageIdByPath.get(parentPath) ?? null
        if (parentId === null) {
          report.skipped += 1
          warn(`${label}: parent page "${parentPath}" does not exist`)
          continue
        }
      }
      const ogMediaId = resolveMedia(item.ogMedia, label)
      const existing = pageByPath.get(item.path)
      try {
        if (!existing) {
          const created = await pagesApi.create(
            {
              slug,
              parentId,
              sortOrder: item.sortOrder,
              sections: item.sections,
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
            context,
          )
          pageByPath.set(item.path, created)
          pageIdByPath.set(item.path, created.id)
          report.created += 1
          continue
        }

        const desiredPublishedAt =
          item.publishedAt ?? (item.status === 'published' ? toIso(existing.publishedAt) : null)
        const desired = {
          title: item.title,
          bodyJson: item.bodyJson ?? EMPTY_DOCUMENT,
          sections: item.sections,
          excerpt: item.excerpt?.trim() ? item.excerpt : null,
          status: item.status,
          publishedAt: desiredPublishedAt,
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
        } else {
          await pagesApi.update(
            existing.id,
            {
              sortOrder: item.sortOrder,
              sections: item.sections,
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
            context,
          )
          report.updated += 1
        }
      } catch (error) {
        failed(label, error)
      }
    }

    // Posts upsert by (postType, slug); taxonomy links resolve through slugs.
    const postRows = await db.query.posts.findMany({
      where: isNull(posts.deletedAt),
      columns: { searchText: false, bodyHtml: false },
    })
    const postByKey = new Map(
      postRows.map((row) => [`${row.postTypeId}/${row.slug}`, row] as const),
    )
    const postLinkRows = await Promise.all([
      db.select().from(postCategories),
      db.select().from(postTags),
    ])
    const categoryIdsOf = new Map<number, number[]>()
    for (const link of postLinkRows[0]) {
      categoryIdsOf.set(link.postId, [...(categoryIdsOf.get(link.postId) ?? []), link.categoryId])
    }
    const tagIdsOf = new Map<number, number[]>()
    for (const link of postLinkRows[1]) {
      tagIdsOf.set(link.postId, [...(tagIdsOf.get(link.postId) ?? []), link.tagId])
    }

    for (const item of bundle.posts) {
      const label = `posts[${item.postType}/${item.slug}]`
      const postTypeId = typeIdBySlug.get(item.postType)
      if (postTypeId === undefined) {
        report.skipped += 1
        warn(`${label}: post type "${item.postType}" does not exist`)
        continue
      }
      const type = await db.query.postTypes.findFirst({ where: eq(postTypes.id, postTypeId) })
      const categoryIds = item.categories.flatMap((slug) => {
        const id = categoryIdByKey.get(`${postTypeId}/${slug}`)
        if (id === undefined) {
          warn(`${label}: category "${slug}" does not exist`)
          return []
        }
        return [id]
      })
      const tagIds = item.tags.flatMap((slug) => {
        const id = tagIdBySlug.get(slug)
        if (id === undefined) {
          warn(`${label}: tag "${slug}" does not exist`)
          return []
        }
        return [id]
      })
      let authorId: number | null = null
      if (item.author !== null) {
        authorId = userIdBySlug.get(item.author) ?? null
        if (authorId === null) warn(`${label}: author "${item.author}" does not exist`)
      }
      const coverMediaId = resolveMedia(item.coverMedia, label)
      const ogMediaId = resolveMedia(item.ogMedia, label)

      const existing = postByKey.get(`${postTypeId}/${item.slug}`)
      try {
        const fields = parsePostFields(type?.fieldsJson, item.fields ?? undefined)
        if (!existing) {
          const created = await postsApi.create(
            {
              postTypeId,
              slug: item.slug,
              title: item.title,
              bodyJson: item.bodyJson ?? undefined,
              excerpt: item.excerpt,
              status: item.status,
              publishedAt: item.publishedAt,
              pinned: item.pinned,
              fields: item.fields ?? undefined,
              coverMediaId,
              ogMediaId,
              categoryIds,
              tagIds,
              seoTitle: item.seoTitle,
              seoDescription: item.seoDescription,
              noindex: item.noindex,
              canonicalUrl: item.canonicalUrl,
            },
            { allowRawHtml: context.allowRawHtml, authorId },
          )
          postByKey.set(`${postTypeId}/${item.slug}`, created)
          report.created += 1
          continue
        }

        const desiredPublishedAt =
          item.publishedAt ?? (item.status === 'published' ? toIso(existing.publishedAt) : null)
        const desired = {
          title: item.title,
          bodyJson: item.bodyJson ?? EMPTY_DOCUMENT,
          excerpt: item.excerpt?.trim() ? item.excerpt : null,
          status: item.status,
          publishedAt: desiredPublishedAt,
          pinned: item.pinned,
          fields,
          coverMediaId,
          ogMediaId,
          authorId,
          categories: [...categoryIds].sort((a, b) => a - b),
          tags: [...tagIds].sort((a, b) => a - b),
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
          categories: [...(categoryIdsOf.get(existing.id) ?? [])].sort((a, b) => a - b),
          tags: [...(tagIdsOf.get(existing.id) ?? [])].sort((a, b) => a - b),
          seoTitle: existing.seoTitle,
          seoDescription: existing.seoDescription,
          noindex: existing.noindex,
          canonicalUrl: existing.canonicalUrl,
        }
        if (sameJson(current, desired)) {
          report.skipped += 1
        } else {
          await postsApi.update(
            existing.id,
            {
              slug: item.slug,
              title: item.title,
              bodyJson: item.bodyJson ?? undefined,
              excerpt: item.excerpt,
              status: item.status,
              publishedAt: item.publishedAt,
              pinned: item.pinned,
              fields: item.fields ?? undefined,
              coverMediaId,
              ogMediaId,
              categoryIds,
              tagIds,
              seoTitle: item.seoTitle,
              seoDescription: item.seoDescription,
              noindex: item.noindex,
              canonicalUrl: item.canonicalUrl,
            },
            { allowRawHtml: context.allowRawHtml, userId: context.userId },
          )
          if (existing.authorId !== authorId) {
            await db.update(posts).set({ authorId }).where(eq(posts.id, existing.id))
          }
          report.updated += 1
        }
      } catch (error) {
        failed(label, error)
      }
    }

    // Redirects upsert by source path.
    const redirectByPath = new Map(
      (await db.query.redirects.findMany()).map((row) => [row.fromPath, row] as const),
    )
    for (const item of bundle.redirects) {
      const label = `redirects[${item.fromPath}]`
      const existing = redirectByPath.get(item.fromPath)
      try {
        if (!existing) {
          await redirectsApi.create(item)
          report.created += 1
        } else if (existing.to === item.to && existing.status === item.status) {
          report.skipped += 1
        } else {
          await redirectsApi.update(existing.id, { to: item.to, status: item.status })
          report.updated += 1
        }
      } catch (error) {
        failed(label, error)
      }
    }

    // Menus upsert by slug.
    const menuBySlug = new Map(
      (await db.query.menus.findMany()).map((row) => [row.slug, row] as const),
    )
    for (const item of bundle.menus) {
      const label = `menus[${item.slug}]`
      const existing = menuBySlug.get(item.slug)
      try {
        if (!existing) {
          await menusApi.create(item)
          report.created += 1
        } else if (existing.name === item.name && sameJson(existing.itemsJson, item.items)) {
          report.skipped += 1
        } else {
          await menusApi.update(existing.id, { name: item.name, items: item.items })
          report.updated += 1
        }
      } catch (error) {
        failed(label, error)
      }
    }

    return report
  }

  async function importSettings(
    values: Record<string, unknown>,
    report: ImportReport,
    warn: WarningSink,
  ) {
    const existing = new Map(
      (await db.query.settings.findMany()).map((row) => [row.key, row.valueJson] as const),
    )
    const mediaIdByKey = new Map(
      (await db.select({ id: media.id, r2Key: media.r2Key }).from(media)).map((row) => [
        row.r2Key,
        row.id,
      ]),
    )
    const pageIdByPath = new Map(
      (
        await db.query.pages.findMany({
          where: isNull(pages.deletedAt),
          columns: { id: true, path: true },
        })
      ).map((row) => [row.path, row.id] as const),
    )

    for (const [key, raw] of Object.entries(values)) {
      const label = `settings[${key}]`
      const schema = SETTINGS_SCHEMAS[key]
      if (!schema) {
        report.skipped += 1
        warn(`${label}: unknown settings key`)
        continue
      }
      const decoded = decodeSettingsValue(key, raw, mediaIdByKey, pageIdByPath, warn)
      const parsed = schema.safeParse(decoded)
      if (!parsed.success) {
        report.skipped += 1
        warn(`${label}: invalid value (${parsed.error.issues[0]?.message ?? 'schema mismatch'})`)
        continue
      }
      const current = existing.get(key)
      if (current !== undefined && sameJson(current, parsed.data)) {
        report.skipped += 1
        continue
      }
      await db
        .insert(settings)
        .values({ key, valueJson: parsed.data })
        .onConflictDoUpdate({ target: settings.key, set: { valueJson: parsed.data } })
      if (current === undefined) report.created += 1
      else report.updated += 1
    }
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
      if (typeof mediaKey === 'string') {
        record[field] = mediaIdByKey.get(mediaKey) ?? null
        if (record[field] === null) warn(`settings[${key}].${field}: media "${mediaKey}" missing`)
      }
    }
  }
  for (const field of SETTINGS_PAGE_FIELDS[key] ?? []) {
    const ref = record[field]
    if (ref !== null && typeof ref === 'object' && !Array.isArray(ref)) {
      const path = (ref as { path?: unknown }).path
      if (typeof path === 'string') {
        record[field] = pageIdByPath.get(path) ?? null
        if (record[field] === null) warn(`settings[${key}].${field}: page "${path}" missing`)
      }
    }
  }
  return record
}

export type TransferService = ReturnType<typeof transferService>
