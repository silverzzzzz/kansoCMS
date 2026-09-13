import {
  type CreatePostInput,
  type ListQuery,
  mediaUrl,
  type RichTextDoc,
  type UpdatePostInput,
} from '@kanso/shared'
import type { SQL } from 'drizzle-orm'
import { and, asc, count, desc, eq, exists, inArray, lte, sql } from 'drizzle-orm'
import { extractExcerpt, renderRichText } from '../content/index.ts'
import type { Db } from '../db/client.ts'
import {
  categories,
  media,
  postCategories,
  posts,
  postTags,
  postTypes,
  tags,
  users,
} from '../db/schema/index.ts'
import { KansoError } from '../errors.ts'
import { assertMediaExists } from './media.ts'

const EMPTY_DOCUMENT: RichTextDoc = { type: 'doc', content: [] }

type RenderContext = { allowRawHtml: boolean }
type CreateContext = RenderContext & { authorId: number | null }
type PostListQuery = ListQuery & { postTypeId?: number }

function searchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}

function searchTitle(query: string): SQL {
  return sql`${posts.title} like ${searchPattern(query)} escape ${'\\'}`
}

function uniqueIds(ids: number[] | undefined): number[] | undefined {
  return ids ? [...new Set(ids)] : undefined
}

function throwPostConflict(error: unknown): never {
  if (error instanceof Error && /unique constraint failed/i.test(error.message)) {
    throw KansoError.conflict('Post slug already exists in this post type')
  }
  throw error
}

/** Predicate for posts visible to the public right now. */
export function postsPublishedNow(now = new Date()) {
  const condition = and(eq(posts.status, 'published'), lte(posts.publishedAt, now))
  if (!condition) throw new Error('Published post predicate could not be built')
  return condition
}

export function postsService(db: Db) {
  async function hydrate(row: typeof posts.$inferSelect) {
    const [categoryRows, tagRows, author, cover, ogMedia] = await Promise.all([
      db
        .select({ id: categories.id, slug: categories.slug, name: categories.name })
        .from(postCategories)
        .innerJoin(categories, eq(postCategories.categoryId, categories.id))
        .where(eq(postCategories.postId, row.id))
        .orderBy(asc(categories.sortOrder), asc(categories.name)),
      db
        .select({ id: tags.id, slug: tags.slug, name: tags.name })
        .from(postTags)
        .innerJoin(tags, eq(postTags.tagId, tags.id))
        .where(eq(postTags.postId, row.id))
        .orderBy(asc(tags.name)),
      row.authorId === null
        ? Promise.resolve(null)
        : db.query.users.findFirst({
            where: eq(users.id, row.authorId),
            columns: { name: true },
          }),
      row.coverMediaId === null
        ? Promise.resolve(null)
        : db.query.media.findFirst({ where: eq(media.id, row.coverMediaId) }),
      row.ogMediaId === null
        ? Promise.resolve(null)
        : db.query.media.findFirst({
            where: eq(media.id, row.ogMediaId),
            columns: { r2Key: true },
          }),
    ])

    return {
      ...row,
      categories: categoryRows,
      tags: tagRows,
      authorName: author?.name ?? null,
      coverMedia: cover
        ? {
            url: mediaUrl(cover.r2Key),
            alt: cover.alt,
            width: cover.width,
            height: cover.height,
          }
        : null,
      ogMediaUrl: ogMedia ? mediaUrl(ogMedia.r2Key) : null,
    }
  }

  async function findPublished(postTypeId: number, slug: string) {
    const post = await db.query.posts.findFirst({
      where: and(eq(posts.postTypeId, postTypeId), eq(posts.slug, slug), postsPublishedNow()),
    })
    return post ? hydrate(post) : null
  }

  async function getWithRelations(id: number) {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, id) })
    if (!post) throw KansoError.notFound('Post')
    return hydrate(post)
  }

  async function listPublished(input: {
    postTypeId: number
    page: number
    perPage: number
    categoryId?: number
    tagId?: number
  }) {
    const conditions: SQL[] = [eq(posts.postTypeId, input.postTypeId), postsPublishedNow()]
    if (input.categoryId !== undefined) {
      conditions.push(
        exists(
          db
            .select({ value: sql<number>`1` })
            .from(postCategories)
            .where(
              and(
                eq(postCategories.postId, posts.id),
                eq(postCategories.categoryId, input.categoryId),
              ),
            ),
        ),
      )
    }
    if (input.tagId !== undefined) {
      conditions.push(
        exists(
          db
            .select({ value: sql<number>`1` })
            .from(postTags)
            .where(and(eq(postTags.postId, posts.id), eq(postTags.tagId, input.tagId))),
        ),
      )
    }
    const where = and(...conditions)
    const [items, totals] = await Promise.all([
      db.query.posts.findMany({
        where,
        orderBy: [desc(posts.publishedAt), desc(posts.id)],
        limit: input.perPage,
        offset: (input.page - 1) * input.perPage,
        columns: { bodyJson: false, bodyHtml: false },
      }),
      db.select({ value: count() }).from(posts).where(where),
    ])
    return { items, total: totals[0]?.value ?? 0 }
  }

  async function listPublishedForSitemap() {
    return db.query.posts.findMany({
      where: and(postsPublishedNow(), eq(posts.noindex, false)),
      orderBy: [desc(posts.publishedAt), desc(posts.id)],
      columns: { postTypeId: true, slug: true, updatedAt: true },
    })
  }

  async function list(query: PostListQuery) {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const conditions: SQL[] = []
    if (query.postTypeId !== undefined) conditions.push(eq(posts.postTypeId, query.postTypeId))
    if (query.status) conditions.push(eq(posts.status, query.status))
    if (query.q) conditions.push(searchTitle(query.q))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [items, totals] = await Promise.all([
      db.query.posts.findMany({
        where,
        orderBy: [desc(sql`coalesce(${posts.publishedAt}, ${posts.createdAt})`), desc(posts.id)],
        limit: perPage,
        offset: (page - 1) * perPage,
        columns: { bodyJson: false, bodyHtml: false },
      }),
      db.select({ value: count() }).from(posts).where(where),
    ])
    return { items, total: totals[0]?.value ?? 0 }
  }

  async function get(id: number) {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, id) })
    if (!post) throw KansoError.notFound('Post')

    const [categoryRows, tagRows] = await Promise.all([
      db
        .select({ id: postCategories.categoryId })
        .from(postCategories)
        .where(eq(postCategories.postId, id))
        .orderBy(asc(postCategories.categoryId)),
      db
        .select({ id: postTags.tagId })
        .from(postTags)
        .where(eq(postTags.postId, id))
        .orderBy(asc(postTags.tagId)),
    ])
    return {
      ...post,
      categoryIds: categoryRows.map((row) => row.id),
      tagIds: tagRows.map((row) => row.id),
    }
  }

  async function getPostTypeForInput(postTypeId: number) {
    const postType = await db.query.postTypes.findFirst({ where: eq(postTypes.id, postTypeId) })
    if (!postType) throw KansoError.validation('Post type does not exist')
    return postType
  }

  async function validateAssociations(
    postTypeId: number,
    categoryIds: number[] | undefined,
    tagIds: number[] | undefined,
  ) {
    const postType = await getPostTypeForInput(postTypeId)
    if (categoryIds && categoryIds.length > 0 && !postType.hasCategories) {
      throw KansoError.validation('This post type does not support categories')
    }
    if (tagIds && tagIds.length > 0 && !postType.hasTags) {
      throw KansoError.validation('This post type does not support tags')
    }

    const [categoryRows, tagRows] = await Promise.all([
      categoryIds && categoryIds.length > 0
        ? db
            .select({ id: categories.id, postTypeId: categories.postTypeId })
            .from(categories)
            .where(inArray(categories.id, categoryIds))
        : Promise.resolve([]),
      tagIds && tagIds.length > 0
        ? db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds))
        : Promise.resolve([]),
    ])

    if (
      categoryIds &&
      (categoryRows.length !== categoryIds.length ||
        categoryRows.some((category) => category.postTypeId !== postTypeId))
    ) {
      throw KansoError.validation('Categories must belong to the post type')
    }
    if (tagIds && tagRows.length !== tagIds.length) {
      throw KansoError.validation('One or more tags do not exist')
    }
  }

  async function assertSlugAvailable(postTypeId: number, slug: string, excludeId?: number) {
    const duplicate = await db.query.posts.findFirst({
      where: and(eq(posts.postTypeId, postTypeId), eq(posts.slug, slug)),
      columns: { id: true },
    })
    if (duplicate && duplicate.id !== excludeId) {
      throw KansoError.conflict('Post slug already exists in this post type')
    }
  }

  async function create(input: CreatePostInput, context: CreateContext) {
    const categoryIds = uniqueIds(input.categoryIds) ?? []
    const tagIds = uniqueIds(input.tagIds) ?? []
    await assertMediaExists(db, input.coverMediaId)
    await assertMediaExists(db, input.ogMediaId)
    await validateAssociations(input.postTypeId, categoryIds, tagIds)
    await assertSlugAvailable(input.postTypeId, input.slug)

    const bodyJson = input.bodyJson ?? EMPTY_DOCUMENT
    const status = input.status ?? 'draft'
    let publishedAt = input.publishedAt ? new Date(input.publishedAt) : null
    if (status === 'published' && publishedAt === null) publishedAt = new Date()
    const excerpt = input.excerpt?.trim() ? input.excerpt : extractExcerpt(bodyJson)

    let postId: number
    try {
      const [created] = await db
        .insert(posts)
        .values({
          postTypeId: input.postTypeId,
          slug: input.slug,
          title: input.title,
          coverMediaId: input.coverMediaId ?? null,
          authorId: context.authorId,
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
        .returning({ id: posts.id })
      if (!created) throw new Error('Post insert did not return a row')
      postId = created.id
    } catch (error) {
      throwPostConflict(error)
    }

    const junctionStatements = [
      ...categoryIds.map((categoryId) => db.insert(postCategories).values({ postId, categoryId })),
      ...tagIds.map((tagId) => db.insert(postTags).values({ postId, tagId })),
    ]
    const [firstStatement, ...remainingStatements] = junctionStatements
    if (firstStatement) await db.batch([firstStatement, ...remainingStatements])
    return get(postId)
  }

  async function update(id: number, input: UpdatePostInput, context: RenderContext) {
    const current = await get(id)
    const categoryIds = uniqueIds(input.categoryIds)
    const tagIds = uniqueIds(input.tagIds)
    await assertMediaExists(db, input.coverMediaId)
    await assertMediaExists(db, input.ogMediaId)
    await validateAssociations(current.postTypeId, categoryIds, tagIds)
    await assertSlugAvailable(current.postTypeId, input.slug ?? current.slug, id)

    const values: Partial<typeof posts.$inferInsert> = { updatedAt: new Date() }
    if (input.slug !== undefined) values.slug = input.slug
    if (input.title !== undefined) values.title = input.title
    if (input.coverMediaId !== undefined) values.coverMediaId = input.coverMediaId
    if (input.status !== undefined) values.status = input.status
    if (input.seoTitle !== undefined) values.seoTitle = input.seoTitle
    if (input.seoDescription !== undefined) values.seoDescription = input.seoDescription
    if (input.ogMediaId !== undefined) values.ogMediaId = input.ogMediaId
    if (input.noindex !== undefined) values.noindex = input.noindex
    if (input.canonicalUrl !== undefined) values.canonicalUrl = input.canonicalUrl

    const bodyJson = input.bodyJson ?? current.bodyJson ?? EMPTY_DOCUMENT
    if (input.bodyJson !== undefined) {
      values.bodyJson = input.bodyJson
      values.bodyHtml = renderRichText(input.bodyJson, context)
    }
    const finalExcerpt = input.excerpt === undefined ? current.excerpt : input.excerpt
    if (input.excerpt !== undefined || (input.bodyJson !== undefined && !finalExcerpt?.trim())) {
      values.excerpt = finalExcerpt?.trim() ? finalExcerpt : extractExcerpt(bodyJson)
    }

    if (input.publishedAt !== undefined) {
      values.publishedAt = input.publishedAt === null ? null : new Date(input.publishedAt)
    }
    const finalStatus = input.status ?? current.status
    const finalPublishedAt =
      input.publishedAt === undefined ? current.publishedAt : (values.publishedAt ?? null)
    if (finalStatus === 'published' && finalPublishedAt === null) values.publishedAt = new Date()

    const categoryStatements =
      categoryIds === undefined
        ? []
        : [
            db.delete(postCategories).where(eq(postCategories.postId, id)),
            ...categoryIds.map((categoryId) =>
              db.insert(postCategories).values({ postId: id, categoryId }),
            ),
          ]
    const tagStatements =
      tagIds === undefined
        ? []
        : [
            db.delete(postTags).where(eq(postTags.postId, id)),
            ...tagIds.map((tagId) => db.insert(postTags).values({ postId: id, tagId })),
          ]

    try {
      await db.batch([
        db.update(posts).set(values).where(eq(posts.id, id)),
        ...categoryStatements,
        ...tagStatements,
      ])
      return get(id)
    } catch (error) {
      throwPostConflict(error)
    }
  }

  async function deletePost(id: number): Promise<void> {
    await get(id)
    await db.delete(posts).where(eq(posts.id, id))
  }

  return {
    findPublished,
    getWithRelations,
    listPublished,
    listPublishedForSitemap,
    list,
    get,
    create,
    update,
    delete: deletePost,
  }
}

export type PostsService = ReturnType<typeof postsService>
