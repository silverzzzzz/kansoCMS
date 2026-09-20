import type {
  CreatePageInput,
  ListQuery,
  PageRevisionSnapshot,
  UpdatePageInput,
} from '@kanso/shared'
import { isReservedSlug } from '@kanso/shared'
import type { SQL } from 'drizzle-orm'
import { and, asc, count, eq, isNull, lte, sql } from 'drizzle-orm'
import { EMPTY_DOCUMENT, renderRichText } from '../content/index.ts'
import type { Db } from '../db/client.ts'
import { media, pages, postTypes } from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'
import { assertMediaExists } from './media.ts'
import { computePaths, hasAncestorCycle } from './page-tree.ts'
import { redirectsService } from './redirects.ts'
import { revisionsService } from './revisions.ts'

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

/** Predicate for "visible to the public right now". Shared by all public reads. */
export function publishedNow(now = new Date()) {
  return and(eq(pages.status, 'published'), lte(pages.publishedAt, now))
}

export function pagesService(db: Db) {
  const redirects = redirectsService(db)
  const revisions = revisionsService(db)

  async function list(query: ListQuery) {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const conditions: SQL[] = []
    if (query.status) conditions.push(eq(pages.status, query.status))
    if (query.q) conditions.push(searchTitle(query.q))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [items, totals] = await Promise.all([
      db.query.pages.findMany({
        where,
        orderBy: [asc(pages.sortOrder), asc(pages.title), asc(pages.id)],
        limit: perPage,
        offset: (page - 1) * perPage,
        columns: { bodyJson: false, bodyHtml: false },
      }),
      db.select({ value: count() }).from(pages).where(where),
    ])
    return { items, total: totals[0]?.value ?? 0 }
  }

  async function get(id: number) {
    const page = await db.query.pages.findFirst({ where: eq(pages.id, id) })
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
      where: and(eq(pages.path, slug), isNull(pages.parentId)),
      columns: { id: true },
    })
    if (page && page.id !== excludePageId) throw KansoError.conflict('Page path already exists')
  }

  async function create(input: CreatePageInput, context: RenderContext) {
    await assertMediaExists(db, input.ogMediaId)
    const parent =
      input.parentId === undefined || input.parentId === null
        ? null
        : await db.query.pages.findFirst({ where: eq(pages.id, input.parentId) })
    if (input.parentId !== undefined && input.parentId !== null && !parent) {
      throw KansoError.validation('Parent page does not exist')
    }
    if (!parent) await assertTopLevelSlugAvailable(input.slug)

    const path = parent ? `${parent.path}/${input.slug}` : input.slug
    const duplicate = await db.query.pages.findFirst({
      where: eq(pages.path, path),
      columns: { id: true },
    })
    if (duplicate) throw KansoError.conflict('Page path already exists')

    const bodyJson = input.bodyJson ?? EMPTY_DOCUMENT
    const status = input.status ?? 'draft'
    let publishedAt = input.publishedAt ? new Date(input.publishedAt) : null
    if (status === 'published' && publishedAt === null) publishedAt = new Date()
    const excerpt = input.excerpt?.trim() ? input.excerpt : null

    try {
      const [created] = await db
        .insert(pages)
        .values({
          title: input.title,
          slug: input.slug,
          path,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
          bodyJson,
          bodyHtml: renderRichText(bodyJson, context),
          excerpt,
          status,
          publishedAt,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
          ogMediaId: input.ogMediaId ?? null,
          noindex: input.noindex ?? false,
          canonicalUrl: input.canonicalUrl ?? null,
        })
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

  async function deletePage(id: number): Promise<void> {
    const current = await get(id)
    const allPages = await db
      .select({ id: pages.id, slug: pages.slug, parentId: pages.parentId, path: pages.path })
      .from(pages)
    const originalParents = new Map(allPages.map((page) => [page.id, page.parentId]))
    const remaining = allPages
      .filter((page) => page.id !== id)
      .map((page) => (page.parentId === id ? { ...page, parentId: current.parentId } : page))
    if (current.parentId === null) {
      for (const page of remaining.filter((page) => originalParents.get(page.id) === id)) {
        await assertTopLevelSlugAvailable(page.slug, page.id)
      }
    }
    const paths = computePaths(remaining)
    if (new Set(paths.values()).size !== paths.size) {
      throw KansoError.conflict('Page path already exists')
    }

    const updates = remaining
      .filter(
        (page) =>
          originalParents.get(page.id) !== page.parentId || paths.get(page.id) !== page.path,
      )
      .map((page) =>
        db
          .update(pages)
          .set({ parentId: page.parentId, path: paths.get(page.id), updatedAt: new Date() })
          .where(eq(pages.id, page.id)),
      )

    try {
      await db.batch([
        db.delete(pages).where(eq(pages.id, id)),
        ...updates,
        revisions.deleteStatement('page', id),
      ])
    } catch (error) {
      throwPageConflict(error)
    }
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
    restoreRevision,
    delete: deletePage,
  }
}

export type PagesService = ReturnType<typeof pagesService>
