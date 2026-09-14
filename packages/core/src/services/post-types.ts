import type { CreatePostTypeInput, UpdatePostTypeInput } from '@kanso/shared'
import { isReservedSlug } from '@kanso/shared'
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { pages, posts, postTypes } from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'

function throwPostTypeConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw KansoError.conflict('Post type slug already exists')
  }
  throw error
}

export function postTypesService(db: Db) {
  async function list() {
    return db.query.postTypes.findMany({
      orderBy: [asc(postTypes.sortOrder), asc(postTypes.name), asc(postTypes.id)],
    })
  }

  async function get(id: number) {
    const postType = await db.query.postTypes.findFirst({ where: eq(postTypes.id, id) })
    if (!postType) throw KansoError.notFound('Post type')
    return postType
  }

  async function findBySlug(slug: string) {
    return db.query.postTypes.findFirst({ where: eq(postTypes.slug, slug) })
  }

  async function assertSlugAvailable(slug: string, excludeId?: number) {
    if (isReservedSlug(slug)) throw KansoError.validation('Post type slug is reserved')

    const page = await db.query.pages.findFirst({
      where: and(eq(pages.path, slug), isNull(pages.parentId)),
      columns: { id: true },
    })
    if (page) throw KansoError.conflict('Slug is used by a page')

    const postType = await findBySlug(slug)
    if (postType && postType.id !== excludeId) {
      throw KansoError.conflict('Post type slug already exists')
    }
  }

  async function create(input: CreatePostTypeInput) {
    await assertSlugAvailable(input.slug)
    try {
      const [created] = await db
        .insert(postTypes)
        .values({
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          hasCategories: input.hasCategories ?? true,
          hasTags: input.hasTags ?? true,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning({ id: postTypes.id })
      if (!created) throw new Error('Post type insert did not return a row')
      return get(created.id)
    } catch (error) {
      throwPostTypeConflict(error)
    }
  }

  async function update(id: number, input: UpdatePostTypeInput) {
    const current = await get(id)
    const slug = input.slug ?? current.slug
    await assertSlugAvailable(slug, id)

    const values: Partial<typeof postTypes.$inferInsert> = { updatedAt: new Date() }
    if (input.slug !== undefined) values.slug = input.slug
    if (input.name !== undefined) values.name = input.name
    if (input.description !== undefined) values.description = input.description
    if (input.hasCategories !== undefined) values.hasCategories = input.hasCategories
    if (input.hasTags !== undefined) values.hasTags = input.hasTags
    if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder

    try {
      await db.update(postTypes).set(values).where(eq(postTypes.id, id))
      return get(id)
    } catch (error) {
      throwPostTypeConflict(error)
    }
  }

  async function deletePostType(id: number): Promise<void> {
    await get(id)
    const [result] = await db.select({ value: count() }).from(posts).where(eq(posts.postTypeId, id))
    if ((result?.value ?? 0) > 0) throw KansoError.conflict('Post type still has posts')
    await db.delete(postTypes).where(eq(postTypes.id, id))
  }

  return { list, get, findBySlug, create, update, delete: deletePostType }
}

export type PostTypesService = ReturnType<typeof postTypesService>
