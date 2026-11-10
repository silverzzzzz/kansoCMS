import type {
  CreatePageInput,
  ListQuery,
  PageRevisionSnapshot,
  UpdatePageInput,
} from '@kanso/shared'
import { isReservedSlug, sectionsPlainText } from '@kanso/shared'
import type { SQL } from 'drizzle-orm'
import { and, asc, count, eq, gt, isNotNull, isNull, like, lte, sql } from 'drizzle-orm'
import { EMPTY_DOCUMENT, plainText, renderRichText } from '../content/index.ts'
import type { Db } from '../db/client.ts'
import { media, pages, postTypes } from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'
import { assertMediaExists } from './media.ts'
import { computePaths, hasAncestorCycle } from './page-tree.ts'
import { redirectsService } from './redirects.ts'
import { revisionsService } from './revisions.ts'
import { shareLinksService } from './share-links.ts'

const TITLE_MAX_LENGTH = 200
const SLUG_MAX_LENGTH = 120
/** `(コピー)` suffix stays under the 200-char title limit. */
export function copyTitle(title: string): string {
  const suffix = ' (コピー)'
  const base =
    title.length > TITLE_MAX_LENGTH - suffix.length
      ? title.slice(0, TITLE_MAX_LENGTH - suffix.length)
      : title
  return `${base}${suffix}`
}

/** `-copy` / `-copy2` … suffixes stay under the 120-char slug limit. */
export function copySlug(slug: string, n: number): string {
  const suffix = n === 1 ? '-copy' : `-copy${n}`
  return `${slug.slice(0, SLUG_MAX_LENGTH - suffix.length)}${suffix}`
}

type RenderContext = { allowRawHtml: boolean }
type UpdateContext = RenderContext & { userId: number | null }

function searchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}

function searchTitle(query: string): SQL {
  return sql`${pages.title} like ${searchPattern(query)} escape ${'\\'}`
}

function throwPageConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw KansoError.conflict('Page path already exists')
  }
  throw error
}

/**
 * Column values for a new page at `path`. Shared by `create` and the starter
 * site's bulk insert so both store the same rendered HTML and search text.
 */
export function pageInsertValues(
  input: CreatePageInput,
  path: string,
  context: RenderContext,
  now = new Date(),
) {
  const bodyJson = input.bodyJson ?? EMPTY_DOCUMENT
  const sectionsJson = input.sections ?? null
  const status = input.status ?? 'draft'
  let publishedAt = input.publishedAt ? new Date(input.publishedAt) : null
  if (status === 'published' && publishedAt === null) publishedAt = now
  return {
    title: input.title,
    slug: input.slug,
    path,
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder ?? 0,
    bodyJson,
    bodyHtml: renderRichText(bodyJson, context),
    sectionsJson,
    searchText: sectionsJson === null ? plainText(bodyJson) : sectionsPlainText(sectionsJson),
    excerpt: input.excerpt?.trim() ? input.excerpt : null,
    status,
    publishedAt,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    ogMediaId: input.ogMediaId ?? null,
    noindex: input.noindex ?? false,
    canonicalUrl: input.canonicalUrl ?? null,
  } satisfies typeof pages.$inferInsert
}

/** Predicate for "visible to the public right now". Shared by all public reads. */
export function publishedNow(now = new Date()) {
  return and(eq(pages.status, 'published'), lte(pages.publishedAt, now), isNull(pages.deletedAt))
}

export function pagesService(db: Db) {
  const redirects = redirectsService(db)
  const revisions = revisionsService(db)
  const shareLinks = shareLinksService(db)

  async function list(query: ListQuery) {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const conditions: SQL[] = [
      query.trashed === 'true' ? isNotNull(pages.deletedAt) : isNull(pages.deletedAt),
    ]
    if (query.status === 'scheduled') {
      conditions.push(eq(pages.status, 'published'), gt(pages.publishedAt, new Date()))
    } else if (query.status) {
      conditions.push(eq(pages.status, query.status))
    }
    if (query.q) conditions.push(searchTitle(query.q))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [items, totals] = await Promise.all([
      db.query.pages.findMany({
        where,
        orderBy: [asc(pages.sortOrder), asc(pages.title), asc(pages.id)],
        limit: perPage,
        offset: (page - 1) * perPage,
        columns: { bodyJson: false, bodyHtml: false, sectionsJson: false, searchText: false },
      }),
      db.select({ value: count() }).from(pages).where(where),
    ])
    return { items, total: totals[0]?.value ?? 0 }
  }

  async function get(id: number) {
    const page = await getAny(id)
    if (page.deletedAt !== null) throw KansoError.notFound('Page')
    return page
  }

  /** Fetch including trashed rows; used by trash/restore internals. */
  async function getAny(id: number) {
    const page = await db.query.pages.findFirst({
      where: eq(pages.id, id),
      columns: { searchText: false },
    })
    if (!page) throw KansoError.notFound('Page')
    return page
  }

  async function assertTopLevelSlugAvailable(slug: string, excludePageId?: number) {
    if (isReservedSlug(slug)) throw KansoError.validation('Page slug is reserved')

    const postType = await db.query.postTypes.findFirst({
      where: eq(postTypes.slug, slug),
      columns: { id: true },
    })
    if (postType) throw KansoError.conflict('Slug is used by a post type')

    const page = await db.query.pages.findFirst({
      where: and(eq(pages.path, slug), isNull(pages.parentId), isNull(pages.deletedAt)),
      columns: { id: true },
    })
    if (page && page.id !== excludePageId) throw KansoError.conflict('Page path already exists')
  }

  async function create(input: CreatePageInput, context: RenderContext) {
    await assertMediaExists(db, input.ogMediaId)
    const parent =
      input.parentId === undefined || input.parentId === null
        ? null
        : await db.query.pages.findFirst({
            where: and(eq(pages.id, input.parentId), isNull(pages.deletedAt)),
          })
    if (input.parentId !== undefined && input.parentId !== null && !parent) {
      throw KansoError.validation('Parent page does not exist')
    }
    if (!parent) await assertTopLevelSlugAvailable(input.slug)

    const path = parent ? `${parent.path}/${input.slug}` : input.slug
    const duplicate = await db.query.pages.findFirst({
      where: and(eq(pages.path, path), isNull(pages.deletedAt)),
      columns: { id: true },
    })
    if (duplicate) throw KansoError.conflict('Page path already exists')

    try {
      const [created] = await db
        .insert(pages)
        .values(pageInsertValues(input, path, context))
        .returning({ id: pages.id })
      if (!created) throw new Error('Page insert did not return a row')
      return get(created.id)
    } catch (error) {
      throwPageConflict(error)
    }
  }

  async function update(id: number, input: UpdatePageInput, context: UpdateContext) {
    const current = await get(id)
    const snapshot: PageRevisionSnapshot = {
      title: current.title,
      slug: current.slug,
      parentId: current.parentId,
      sortOrder: current.sortOrder,
      bodyJson: current.bodyJson ?? EMPTY_DOCUMENT,
      sections: current.sectionsJson,
      excerpt: current.excerpt,
      status: current.status,
      publishedAt: current.publishedAt?.toISOString() ?? null,
      seoTitle: current.seoTitle,
      seoDescription: current.seoDescription,
      ogMediaId: current.ogMediaId,
      noindex: current.noindex,
      canonicalUrl: current.canonicalUrl,
    }
    await assertMediaExists(db, input.ogMediaId)
    const allPages = await db
      .select({
        id: pages.id,
        slug: pages.slug,
        parentId: pages.parentId,
        path: pages.path,
        status: pages.status,
      })
      .from(pages)
      .where(isNull(pages.deletedAt))

    const parentId = input.parentId === undefined ? current.parentId : input.parentId
    if (parentId !== null && !allPages.some((page) => page.id === parentId)) {
      throw KansoError.validation('Parent page does not exist')
    }
    if (hasAncestorCycle(allPages, id, parentId)) {
      throw KansoError.validation('Page cannot be its own ancestor')
    }

    const slug = input.slug ?? current.slug
    if (parentId === null) await assertTopLevelSlugAvailable(slug, id)

    const tree = allPages.map((page) =>
      page.id === id
        ? { id, slug, parentId }
        : { id: page.id, slug: page.slug, parentId: page.parentId },
    )
    const paths = computePaths(tree)
    if (new Set(paths.values()).size !== paths.size) {
      throw KansoError.conflict('Page path already exists')
    }

    const values: Partial<typeof pages.$inferInsert> = { updatedAt: new Date() }
    if (input.title !== undefined) values.title = input.title
    if (input.slug !== undefined) values.slug = input.slug
    if (input.parentId !== undefined) values.parentId = input.parentId
    if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder
    if (input.status !== undefined) values.status = input.status
    if (input.seoTitle !== undefined) values.seoTitle = input.seoTitle
    if (input.seoDescription !== undefined) values.seoDescription = input.seoDescription
    if (input.ogMediaId !== undefined) values.ogMediaId = input.ogMediaId
    if (input.noindex !== undefined) values.noindex = input.noindex
    if (input.canonicalUrl !== undefined) values.canonicalUrl = input.canonicalUrl

    if (input.bodyJson !== undefined) {
      values.bodyJson = input.bodyJson
      values.bodyHtml = renderRichText(input.bodyJson, context)
    }
    if (input.sections !== undefined) values.sectionsJson = input.sections
    if (input.bodyJson !== undefined || input.sections !== undefined) {
      const sections = input.sections === undefined ? current.sectionsJson : input.sections
      values.searchText =
        sections === null
          ? plainText(input.bodyJson ?? current.bodyJson ?? EMPTY_DOCUMENT)
          : sectionsPlainText(sections)
    }
    if (input.excerpt !== undefined) {
      values.excerpt = input.excerpt?.trim() ? input.excerpt : null
    }

    if (input.publishedAt !== undefined) {
      values.publishedAt = input.publishedAt === null ? null : new Date(input.publishedAt)
    }
    const finalStatus = input.status ?? current.status
    const finalPublishedAt =
      input.publishedAt === undefined ? current.publishedAt : (values.publishedAt ?? null)
    if (finalStatus === 'published' && finalPublishedAt === null) values.publishedAt = new Date()

    const targetPath = paths.get(id)
    if (!targetPath) throw new Error('Updated page path was not computed')
    values.path = targetPath

    const descendantUpdates = allPages
      .filter((page) => page.id !== id && paths.get(page.id) !== page.path)
      .map((page) =>
        db
          .update(pages)
          .set({ path: paths.get(page.id), updatedAt: new Date() })
          .where(eq(pages.id, page.id)),
      )

    const redirectStatements = [
      ...(current.status === 'published'
        ? redirects.pathChangeStatements(current.path, targetPath)
        : []),
      ...allPages.flatMap((page) => {
        const newPath = paths.get(page.id)
        return page.id !== id &&
          page.status === 'published' &&
          newPath !== undefined &&
          newPath !== page.path
          ? redirects.pathChangeStatements(page.path, newPath)
          : []
      }),
    ]

    try {
      await db.batch([
        db.update(pages).set(values).where(eq(pages.id, id)),
        ...descendantUpdates,
        ...redirectStatements,
        ...revisions.recordStatements('page', id, snapshot, context.userId),
      ])
      return get(id)
    } catch (error) {
      throwPageConflict(error)
    }
  }

  /**
   * Hard delete: reparent children (live and trashed) to the deleted page's
   * parent and recompute live paths. Trashed descendants keep their stale
   * paths; a restore recomputes them anyway.
   */
  async function purgePage(id: number): Promise<void> {
    const current = await getAny(id)
    const allPages = await db
      .select({
        id: pages.id,
        slug: pages.slug,
        parentId: pages.parentId,
        path: pages.path,
        deletedAt: pages.deletedAt,
      })
      .from(pages)
    const originalParents = new Map(allPages.map((page) => [page.id, page.parentId]))
    const remaining = allPages
      .filter((page) => page.id !== id)
      .map((page) => (page.parentId === id ? { ...page, parentId: current.parentId } : page))
    const live = remaining.filter((page) => page.deletedAt === null)
    if (current.parentId === null) {
      for (const page of live.filter((page) => originalParents.get(page.id) === id)) {
        await assertTopLevelSlugAvailable(page.slug, page.id)
      }
    }
    const paths = computePaths(live)
    if (new Set(paths.values()).size !== paths.size) {
      throw KansoError.conflict('Page path already exists')
    }

    const updates = remaining
      .filter(
        (page) =>
          originalParents.get(page.id) !== page.parentId ||
          (page.deletedAt === null && paths.get(page.id) !== page.path),
      )
      .map((page) =>
        db
          .update(pages)
          .set({
            parentId: page.parentId,
            ...(page.deletedAt === null ? { path: paths.get(page.id) } : {}),
            updatedAt: new Date(),
          })
          .where(eq(pages.id, page.id)),
      )

    try {
      await db.batch([
        db.delete(pages).where(eq(pages.id, id)),
        ...updates,
        revisions.deleteStatement('page', id),
        shareLinks.deleteForTargetStatement('page', id),
      ])
    } catch (error) {
      throwPageConflict(error)
    }
  }

  /**
   * `DELETE /pages/:id` trashes; a second delete or `?force=true` purges.
   * Trashing cascades to live descendants via the materialized path prefix.
   */
  async function deletePage(id: number, options?: { force?: boolean }): Promise<void> {
    const current = await getAny(id)
    if (options?.force || current.deletedAt !== null) return purgePage(id)
    const now = new Date()
    await db.batch([
      db.update(pages).set({ deletedAt: now, updatedAt: now }).where(eq(pages.id, id)),
      db
        .update(pages)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(like(pages.path, `${current.path}/%`), isNull(pages.deletedAt))),
    ])
  }

  /** Restore a trashed page. Descendants stay trashed and restore individually. */
  async function restorePage(id: number) {
    const current = await getAny(id)
    if (current.deletedAt === null) throw KansoError.validation('Page is not in the trash')

    const parent =
      current.parentId === null
        ? null
        : await db.query.pages.findFirst({ where: eq(pages.id, current.parentId) })
    if (current.parentId !== null && !parent) {
      throw KansoError.validation('Parent page does not exist')
    }
    if (parent && parent.deletedAt !== null) {
      throw KansoError.validation('Restore the parent page first')
    }

    if (parent === null) await assertTopLevelSlugAvailable(current.slug, id)
    const path = parent ? `${parent.path}/${current.slug}` : current.slug
    const duplicate = await db.query.pages.findFirst({
      where: and(eq(pages.path, path), isNull(pages.deletedAt)),
      columns: { id: true },
    })
    if (duplicate && duplicate.id !== id) throw KansoError.conflict('Page path already exists')

    try {
      await db
        .update(pages)
        .set({ deletedAt: null, path, updatedAt: new Date() })
        .where(eq(pages.id, id))
      return get(id)
    } catch (error) {
      throwPageConflict(error)
    }
  }

  /**
   * Copy a page as a draft under the same parent. The slug gains `-copy`
   * (`-copy2`, … on collision); the title gains ` (コピー)`.
   */
  async function duplicate(id: number, context: RenderContext) {
    const current = await get(id)
    for (let n = 1; n <= 10; n++) {
      try {
        return await create(
          {
            title: copyTitle(current.title),
            slug: copySlug(current.slug, n),
            parentId: current.parentId,
            sortOrder: current.sortOrder,
            bodyJson: current.bodyJson ?? undefined,
            sections: current.sectionsJson ?? null,
            excerpt: current.excerpt,
            status: 'draft',
            publishedAt: null,
            seoTitle: current.seoTitle,
            seoDescription: current.seoDescription,
            ogMediaId: current.ogMediaId,
            noindex: current.noindex,
            canonicalUrl: current.canonicalUrl,
          },
          context,
        )
      } catch (error) {
        if (error instanceof KansoError && error.code === 'conflict' && n < 10) continue
        throw error
      }
    }
    throw KansoError.conflict('Could not find a free slug')
  }

  async function restoreRevision(id: number, revisionId: number, context: UpdateContext) {
    const revision = await revisions.get('page', id, revisionId)
    const snapshot = revision.snapshot as PageRevisionSnapshot
    const [parent, ogMedia] = await Promise.all([
      snapshot.parentId === null || snapshot.parentId === id
        ? Promise.resolve(null)
        : db.query.pages.findFirst({
            where: eq(pages.id, snapshot.parentId),
            columns: { id: true },
          }),
      snapshot.ogMediaId === null
        ? Promise.resolve(null)
        : db.query.media.findFirst({
            where: eq(media.id, snapshot.ogMediaId),
            columns: { id: true },
          }),
    ])

    return update(
      id,
      {
        ...snapshot,
        sections: snapshot.sections ?? null,
        parentId: parent?.id ?? null,
        ogMediaId: ogMedia?.id ?? null,
      },
      context,
    )
  }

  return {
    /** Public: resolve a URL path (no leading slash) to a published page. */
    async findPublishedByPath(path: string) {
      return db.query.pages.findFirst({
        where: and(eq(pages.path, path), publishedNow()),
        columns: { searchText: false },
      })
    },

    /** Public: a published page by id (e.g. the configured custom 404). */
    async findPublishedById(id: number) {
      return db.query.pages.findFirst({
        where: and(eq(pages.id, id), publishedNow()),
        columns: { searchText: false },
      })
    },

    /** Public: top-level published pages, for navigation. */
    async listPublishedTopLevel() {
      return db.query.pages.findMany({
        where: and(publishedNow(), isNull(pages.parentId)),
        orderBy: [asc(pages.sortOrder), asc(pages.title)],
        columns: { id: true, slug: true, path: true, title: true },
      })
    },

    /**
     * Public: the page's published ancestors, root first, for breadcrumbs.
     * An unpublished or missing ancestor ends the chain; a cycle in the tree
     * cannot loop forever.
     */
    async listPublishedAncestors(page: { parentId: number | null }) {
      if (page.parentId === null) return []
      const all = await db.query.pages.findMany({
        where: publishedNow(),
        columns: { id: true, parentId: true, path: true, title: true },
      })
      const byId = new Map(all.map((row) => [row.id, row]))
      const chain: typeof all = []
      const visited = new Set<number>()
      let parentId: number | null = page.parentId
      while (parentId !== null && !visited.has(parentId)) {
        visited.add(parentId)
        const parent = byId.get(parentId)
        if (!parent) break
        chain.unshift(parent)
        parentId = parent.parentId
      }
      return chain
    },

    async listPublishedForSitemap() {
      return db.query.pages.findMany({
        where: and(publishedNow(), eq(pages.noindex, false)),
        orderBy: [asc(pages.path)],
        columns: { path: true, updatedAt: true },
      })
    },

    list,
    get,
    create,
    update,
    duplicate,
    restore: restorePage,
    restoreRevision,
    delete: deletePage,
  }
}

export type PagesService = ReturnType<typeof pagesService>
