import {
  type CreatePostInput,
  type ListQuery,
  mediaUrl,
  type PostRevisionSnapshot,
  type SectionField,
  type SectionValues,
  sectionValuesSchemaFor,
  type UpdatePostInput,
} from '@kanso/shared'
import type { SQL } from 'drizzle-orm'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm'
import { EMPTY_DOCUMENT, effectiveExcerpt, plainText, renderRichText } from '../content/index.ts'
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
import { contains } from '../db/search.ts'
import { assertUnchangedSince, isUniqueViolation, KansoError } from '../errors.ts'
import { assertMediaExists, toSiteImage } from './media.ts'
import { copySlug, copyTitle } from './pages.ts'
import { redirectsService } from './redirects.ts'
import { revisionsService } from './revisions.ts'
import { shareLinksService } from './share-links.ts'

type RenderContext = { allowRawHtml: boolean }
type CreateContext = RenderContext & { authorId: number | null }
type UpdateContext = RenderContext & { userId: number | null }
type PostListQuery = ListQuery & { postTypeId?: number }

function uniqueIds(ids: number[] | undefined): number[] | undefined {
  return ids ? [...new Set(ids)] : undefined
}

/** Validate custom field values against the post type's field definitions (section field DSL). */
export function parsePostFields(
  defs: SectionField[] | null | undefined,
  raw: Record<string, unknown> | undefined,
): SectionValues | null {
  if (!defs || defs.length === 0) return null
  const defined = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([key]) => defs.some((def) => def.name === key)),
  )
  const result = sectionValuesSchemaFor(defs).safeParse(defined)
  if (!result.success) {
    throw KansoError.validation(
      'Invalid custom fields',
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    )
  }
  // Defined values win after validation; extra keys pass through untouched.
  return { ...((raw ?? {}) as SectionValues), ...result.data }
}

function throwPostConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw KansoError.conflict('Post slug already exists in this post type')
  }
  throw error
}

/** The parts of a post insert that do not depend on its post type or taxonomy links. */
export type PostContentInput = Omit<CreatePostInput, 'postTypeId' | 'categoryIds' | 'tagIds'>

/**
 * Column values for a new post, minus `postTypeId`. Shared by `create` and the
 * starter site's bulk insert so both store the same rendered HTML and search text.
 */
export function postInsertValues(
  input: PostContentInput,
  context: CreateContext,
  now = new Date(),
) {
  const bodyJson = input.bodyJson ?? EMPTY_DOCUMENT
  const status = input.status ?? 'draft'
  let publishedAt = input.publishedAt ? new Date(input.publishedAt) : null
  if (status === 'published' && publishedAt === null) publishedAt = now
  return {
    slug: input.slug,
    title: input.title,
    coverMediaId: input.coverMediaId ?? null,
    authorId: context.authorId,
    bodyJson,
    bodyHtml: renderRichText(bodyJson, context),
    searchText: plainText(bodyJson),
    excerpt: input.excerpt?.trim() ? input.excerpt : null,
    status,
    publishedAt,
    pinned: input.pinned ?? false,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    ogMediaId: input.ogMediaId ?? null,
    noindex: input.noindex ?? false,
    canonicalUrl: input.canonicalUrl ?? null,
  } satisfies Omit<typeof posts.$inferInsert, 'postTypeId'>
}

/** Predicate for posts visible to the public right now. */
export function postsPublishedNow(now = new Date()) {
  const condition = and(
    eq(posts.status, 'published'),
    lte(posts.publishedAt, now),
    isNull(posts.deletedAt),
  )
  if (!condition) throw new Error('Published post predicate could not be built')
  return condition
}

/** Public list ordering: sticky posts first, then newest published. */
export function postsListOrder() {
  return [desc(posts.pinned), desc(posts.publishedAt), desc(posts.id)]
}

export function postsService(db: Db) {
  const redirects = redirectsService(db)
  const revisions = revisionsService(db)
  const shareLinks = shareLinksService(db)

  async function hydrate(row: Omit<typeof posts.$inferSelect, 'searchText'>) {
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
            columns: { name: true, slug: true },
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
      authorSlug: author?.slug ?? null,
      coverMedia: cover ? toSiteImage(cover) : null,
      ogMediaUrl: ogMedia ? mediaUrl(ogMedia.r2Key) : null,
    }
  }

  async function findPublished(postTypeId: number, slug: string) {
    const post = await db.query.posts.findFirst({
      where: and(eq(posts.postTypeId, postTypeId), eq(posts.slug, slug), postsPublishedNow()),
      columns: { searchText: false },
    })
    return post ? hydrate(post) : null
  }

  async function getWithRelations(id: number) {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      columns: { searchText: false },
    })
    if (!post || post.deletedAt !== null) throw KansoError.notFound('Post')
    return hydrate(post)
  }

  async function listPublished(input: {
    postTypeId: number
    page: number
    perPage: number
    categoryId?: number
    tagId?: number
    authorId?: number
    /** `pinned` (default) puts sticky posts first; `newest` is strictly chronological. */
    order?: 'pinned' | 'newest'
  }) {
    const conditions: SQL[] = [eq(posts.postTypeId, input.postTypeId), postsPublishedNow()]
    if (input.authorId !== undefined) conditions.push(eq(posts.authorId, input.authorId))
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
        orderBy:
          input.order === 'newest' ? [desc(posts.publishedAt), desc(posts.id)] : postsListOrder(),
        limit: input.perPage,
        offset: (input.page - 1) * input.perPage,
        columns: { bodyHtml: false, searchText: false },
      }),
      db.select({ value: count() }).from(posts).where(where),
    ])
    return {
      items: items.map(({ bodyJson, ...rest }) => ({
        ...rest,
        excerpt: effectiveExcerpt({ excerpt: rest.excerpt, bodyJson }),
      })),
      total: totals[0]?.value ?? 0,
    }
  }

  /**
   * Same-type published posts sharing a category (falling back to a shared
   * tag), newest first. Returns [] when the post has neither taxonomy.
   */
  async function listRelated(input: {
    postTypeId: number
    excludeId: number
    categoryIds: number[]
    tagIds: number[]
    limit?: number
  }) {
    const limit = input.limit ?? 4
    const linkFor = (ids: number[], kind: 'category' | 'tag') =>
      kind === 'category'
        ? exists(
            db
              .select({ value: sql<number>`1` })
              .from(postCategories)
              .where(
                and(eq(postCategories.postId, posts.id), inArray(postCategories.categoryId, ids)),
              ),
          )
        : exists(
            db
              .select({ value: sql<number>`1` })
              .from(postTags)
              .where(and(eq(postTags.postId, posts.id), inArray(postTags.tagId, ids))),
          )

    const condition =
      input.categoryIds.length > 0
        ? linkFor(input.categoryIds, 'category')
        : input.tagIds.length > 0
          ? linkFor(input.tagIds, 'tag')
          : null
    if (!condition) return { items: [] }

    const items = await db.query.posts.findMany({
      where: and(
        eq(posts.postTypeId, input.postTypeId),
        ne(posts.id, input.excludeId),
        postsPublishedNow(),
        condition,
      ),
      orderBy: [desc(posts.publishedAt), desc(posts.id)],
      limit,
      columns: { bodyHtml: false, searchText: false },
    })
    return {
      items: items.map(({ bodyJson, ...rest }) => ({
        ...rest,
        excerpt: effectiveExcerpt({ excerpt: rest.excerpt, bodyJson }),
      })),
    }
  }

  /** `(postTypeId, authorSlug)` pairs with ≥1 published indexable post, newest update. */
  async function listAuthorsForSitemap() {
    return db
      .select({
        postTypeId: posts.postTypeId,
        slug: users.slug,
        updatedAt: sql`max(${posts.updatedAt})`.mapWith(posts.updatedAt),
      })
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .where(and(postsPublishedNow(), eq(posts.noindex, false), isNotNull(users.slug)))
      .groupBy(posts.postTypeId, users.slug)
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
    const conditions: SQL[] = [
      query.trashed === 'true' ? isNotNull(posts.deletedAt) : isNull(posts.deletedAt),
    ]
    if (query.postTypeId !== undefined) conditions.push(eq(posts.postTypeId, query.postTypeId))
    if (query.status === 'scheduled') {
      conditions.push(eq(posts.status, 'published'), gt(posts.publishedAt, new Date()))
    } else if (query.status) {
      conditions.push(eq(posts.status, query.status))
    }
    if (query.q) conditions.push(contains(posts.title, query.q))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [items, totals] = await Promise.all([
      db.query.posts.findMany({
        where,
        orderBy: [desc(sql`coalesce(${posts.publishedAt}, ${posts.createdAt})`), desc(posts.id)],
        limit: perPage,
        offset: (page - 1) * perPage,
        columns: { bodyJson: false, bodyHtml: false, searchText: false },
      }),
      db.select({ value: count() }).from(posts).where(where),
    ])
    return { items, total: totals[0]?.value ?? 0 }
  }

  /** Fetch including trashed rows; used by trash/restore internals. */
  async function getAny(id: number) {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      columns: { searchText: false },
    })
    if (!post) throw KansoError.notFound('Post')
    return post
  }

  async function get(id: number) {
    const post = await getAny(id)
    if (post.deletedAt !== null) throw KansoError.notFound('Post')

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
    postType: { id: number; hasCategories: boolean; hasTags: boolean },
    categoryIds: number[] | undefined,
    tagIds: number[] | undefined,
  ) {
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
        categoryRows.some((category) => category.postTypeId !== postType.id))
    ) {
      throw KansoError.validation('Categories must belong to the post type')
    }
    if (tagIds && tagRows.length !== tagIds.length) {
      throw KansoError.validation('One or more tags do not exist')
    }
  }

  async function assertSlugAvailable(postTypeId: number, slug: string, excludeId?: number) {
    const duplicate = await db.query.posts.findFirst({
      where: and(eq(posts.postTypeId, postTypeId), eq(posts.slug, slug), isNull(posts.deletedAt)),
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
    const postType = await getPostTypeForInput(input.postTypeId)
    await validateAssociations(postType, categoryIds, tagIds)
    await assertSlugAvailable(input.postTypeId, input.slug)
    const fieldsJson = parsePostFields(postType.fieldsJson, input.fields)

    let postId: number
    try {
      const [created] = await db
        .insert(posts)
        .values({ postTypeId: input.postTypeId, fieldsJson, ...postInsertValues(input, context) })
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

  async function update(id: number, input: UpdatePostInput, context: UpdateContext) {
    const current = await get(id)
    assertUnchangedSince('Post', current.updatedAt, input.baseUpdatedAt)
    const snapshot: PostRevisionSnapshot = {
      title: current.title,
      slug: current.slug,
      bodyJson: current.bodyJson ?? EMPTY_DOCUMENT,
      excerpt: current.excerpt,
      status: current.status,
      publishedAt: current.publishedAt?.toISOString() ?? null,
      coverMediaId: current.coverMediaId,
      pinned: current.pinned,
      categoryIds: current.categoryIds,
      tagIds: current.tagIds,
      seoTitle: current.seoTitle,
      seoDescription: current.seoDescription,
      ogMediaId: current.ogMediaId,
      noindex: current.noindex,
      canonicalUrl: current.canonicalUrl,
      fields: current.fieldsJson ?? {},
    }
    const categoryIds = uniqueIds(input.categoryIds)
    const tagIds = uniqueIds(input.tagIds)
    await assertMediaExists(db, input.coverMediaId)
    await assertMediaExists(db, input.ogMediaId)
    const postType = await getPostTypeForInput(current.postTypeId)
    await validateAssociations(postType, categoryIds, tagIds)
    await assertSlugAvailable(current.postTypeId, input.slug ?? current.slug, id)

    const values: Partial<typeof posts.$inferInsert> = { updatedAt: new Date() }
    if (input.slug !== undefined) values.slug = input.slug
    if (input.title !== undefined) values.title = input.title
    if (input.coverMediaId !== undefined) values.coverMediaId = input.coverMediaId
    if (input.status !== undefined) values.status = input.status
    if (input.pinned !== undefined) values.pinned = input.pinned
    if (input.seoTitle !== undefined) values.seoTitle = input.seoTitle
    if (input.seoDescription !== undefined) values.seoDescription = input.seoDescription
    if (input.ogMediaId !== undefined) values.ogMediaId = input.ogMediaId
    if (input.noindex !== undefined) values.noindex = input.noindex
    if (input.canonicalUrl !== undefined) values.canonicalUrl = input.canonicalUrl
    if (input.fields !== undefined) {
      values.fieldsJson = parsePostFields(postType.fieldsJson, input.fields)
    }

    if (input.bodyJson !== undefined) {
      values.bodyJson = input.bodyJson
      values.bodyHtml = renderRichText(input.bodyJson, context)
      values.searchText = plainText(input.bodyJson)
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

    let redirectStatements: ReturnType<typeof redirects.pathChangeStatements> = []
    if (input.slug !== undefined && input.slug !== current.slug && current.status === 'published') {
      redirectStatements = redirects.pathChangeStatements(
        `${postType.slug}/${current.slug}`,
        `${postType.slug}/${input.slug}`,
      )
    }

    try {
      await db.batch([
        db.update(posts).set(values).where(eq(posts.id, id)),
        ...categoryStatements,
        ...tagStatements,
        ...redirectStatements,
        ...revisions.recordStatements('post', id, snapshot, context.userId),
      ])
      return get(id)
    } catch (error) {
      throwPostConflict(error)
    }
  }

  /**
   * `DELETE /posts/:id` trashes; only `?force=true` purges. Repeating the
   * request on a trashed post is a no-op (see `pages.delete`).
   */
  async function deletePost(id: number, options?: { force?: boolean }): Promise<void> {
    const current = await getAny(id)
    if (options?.force) {
      await db.batch([
        db.delete(posts).where(eq(posts.id, id)),
        revisions.deleteStatement('post', id),
        shareLinks.deleteForTargetStatement('post', id),
      ])
      return
    }
    if (current.deletedAt !== null) return
    await db
      .update(posts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(posts.id, id))
  }

  /** Restore a trashed post after checking its slug is still free. */
  async function restorePost(id: number) {
    const current = await getAny(id)
    if (current.deletedAt === null) throw KansoError.validation('Post is not in the trash')
    await assertSlugAvailable(current.postTypeId, current.slug, id)
    try {
      await db.update(posts).set({ deletedAt: null, updatedAt: new Date() }).where(eq(posts.id, id))
      return get(id)
    } catch (error) {
      throwPostConflict(error)
    }
  }

  /**
   * Copy a post as a draft in the same post type. The slug gains `-copy`
   * (`-copy2`, … on collision); the title gains ` (コピー)`; taxonomies,
   * cover and SEO fields carry over; the duplicating user becomes author.
   */
  async function duplicate(id: number, context: CreateContext) {
    const current = await get(id)
    for (let n = 1; n <= 10; n++) {
      try {
        return await create(
          {
            postTypeId: current.postTypeId,
            title: copyTitle(current.title),
            slug: copySlug(current.slug, n),
            status: 'draft',
            publishedAt: null,
            bodyJson: current.bodyJson ?? undefined,
            excerpt: current.excerpt,
            coverMediaId: current.coverMediaId,
            categoryIds: current.categoryIds,
            tagIds: current.tagIds,
            seoTitle: current.seoTitle,
            seoDescription: current.seoDescription,
            ogMediaId: current.ogMediaId,
            noindex: current.noindex,
            canonicalUrl: current.canonicalUrl,
            fields: current.fieldsJson ?? {},
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
    const current = await get(id)
    const revision = await revisions.get('post', id, revisionId)
    const snapshot = revision.snapshot as PostRevisionSnapshot
    const mediaIds = [snapshot.coverMediaId, snapshot.ogMediaId].filter(
      (mediaId): mediaId is number => mediaId !== null,
    )
    const [mediaRows, categoryRows, tagRows] = await Promise.all([
      mediaIds.length > 0
        ? db.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds))
        : Promise.resolve([]),
      snapshot.categoryIds.length > 0
        ? db
            .select({ id: categories.id })
            .from(categories)
            .where(
              and(
                inArray(categories.id, snapshot.categoryIds),
                eq(categories.postTypeId, current.postTypeId),
              ),
            )
        : Promise.resolve([]),
      snapshot.tagIds.length > 0
        ? db.select({ id: tags.id }).from(tags).where(inArray(tags.id, snapshot.tagIds))
        : Promise.resolve([]),
    ])
    const existingMediaIds = new Set(mediaRows.map((row) => row.id))
    const existingCategoryIds = new Set(categoryRows.map((row) => row.id))
    const existingTagIds = new Set(tagRows.map((row) => row.id))

    return update(
      id,
      {
        ...snapshot,
        coverMediaId:
          snapshot.coverMediaId !== null && existingMediaIds.has(snapshot.coverMediaId)
            ? snapshot.coverMediaId
            : null,
        ogMediaId:
          snapshot.ogMediaId !== null && existingMediaIds.has(snapshot.ogMediaId)
            ? snapshot.ogMediaId
            : null,
        categoryIds: snapshot.categoryIds.filter((categoryId) =>
          existingCategoryIds.has(categoryId),
        ),
        tagIds: snapshot.tagIds.filter((tagId) => existingTagIds.has(tagId)),
      },
      context,
    )
  }

  return {
    findPublished,
    getWithRelations,
    listPublished,
    listRelated,
    listAuthorsForSitemap,
    listPublishedForSitemap,
    list,
    get,
    create,
    update,
    duplicate,
    restore: restorePost,
    restoreRevision,
    delete: deletePost,
  }
}

export type PostsService = ReturnType<typeof postsService>
