import type {
  CreateCategoryInput,
  CreateTagInput,
  UpdateCategoryInput,
  UpdateTagInput,
} from '@kanso/shared'
import type { SQL } from 'drizzle-orm'
import { and, asc, eq, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { categories, postTypes, tags } from '../db/schema/index.ts'
import { KansoError } from '../errors.ts'
import { hasAncestorCycle } from './page-tree.ts'

function searchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}

function searchTags(query: string): SQL | undefined {
  const pattern = searchPattern(query)
  return or(
    sql`${tags.name} like ${pattern} escape ${'\\'}`,
    sql`${tags.slug} like ${pattern} escape ${'\\'}`,
  )
}

function throwTaxonomyConflict(error: unknown, message: string): never {
  if (error instanceof Error && /unique constraint failed/i.test(error.message)) {
    throw KansoError.conflict(message)
  }
  throw error
}

export function taxonomiesService(db: Db) {
  async function findCategoryBySlug(postTypeId: number, slug: string) {
    return db.query.categories.findFirst({
      where: and(eq(categories.postTypeId, postTypeId), eq(categories.slug, slug)),
    })
  }

  async function findTagBySlug(slug: string) {
    return db.query.tags.findFirst({ where: eq(tags.slug, slug) })
  }

  async function requirePostType(postTypeId: number) {
    const postType = await db.query.postTypes.findFirst({ where: eq(postTypes.id, postTypeId) })
    if (!postType) throw KansoError.notFound('Post type')
    return postType
  }

  async function getCategory(postTypeId: number, id: number) {
    const category = await db.query.categories.findFirst({
      where: and(eq(categories.id, id), eq(categories.postTypeId, postTypeId)),
    })
    if (!category) throw KansoError.notFound('Category')
    return category
  }

  async function listCategories(postTypeId: number) {
    await requirePostType(postTypeId)
    return db.query.categories.findMany({
      where: eq(categories.postTypeId, postTypeId),
      orderBy: [asc(categories.sortOrder), asc(categories.name), asc(categories.id)],
    })
  }

  async function assertCategorySlugAvailable(postTypeId: number, slug: string, excludeId?: number) {
    const category = await db.query.categories.findFirst({
      where: and(eq(categories.postTypeId, postTypeId), eq(categories.slug, slug)),
      columns: { id: true },
    })
    if (category && category.id !== excludeId) {
      throw KansoError.conflict('Category slug already exists')
    }
  }

  async function requireValidCategoryParent(
    postTypeId: number,
    parentId: number | null,
  ): Promise<void> {
    if (parentId === null) return
    const parent = await db.query.categories.findFirst({
      where: and(eq(categories.id, parentId), eq(categories.postTypeId, postTypeId)),
      columns: { id: true },
    })
    if (!parent) throw KansoError.validation('Parent category does not exist in this post type')
  }

  async function createCategory(postTypeId: number, input: CreateCategoryInput) {
    await requirePostType(postTypeId)
    const parentId = input.parentId ?? null
    await requireValidCategoryParent(postTypeId, parentId)
    await assertCategorySlugAvailable(postTypeId, input.slug)

    try {
      const [created] = await db
        .insert(categories)
        .values({
          postTypeId,
          slug: input.slug,
          name: input.name,
          parentId,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning({ id: categories.id })
      if (!created) throw new Error('Category insert did not return a row')
      return getCategory(postTypeId, created.id)
    } catch (error) {
      throwTaxonomyConflict(error, 'Category slug already exists')
    }
  }

  async function updateCategory(postTypeId: number, id: number, input: UpdateCategoryInput) {
    const current = await getCategory(postTypeId, id)
    const parentId = input.parentId === undefined ? current.parentId : input.parentId
    await requireValidCategoryParent(postTypeId, parentId)

    const allCategories = await db
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.postTypeId, postTypeId))
    if (hasAncestorCycle(allCategories, id, parentId)) {
      throw KansoError.validation('Category cannot be its own ancestor')
    }
    await assertCategorySlugAvailable(postTypeId, input.slug ?? current.slug, id)

    const values: Partial<typeof categories.$inferInsert> = {}
    if (input.slug !== undefined) values.slug = input.slug
    if (input.name !== undefined) values.name = input.name
    if (input.parentId !== undefined) values.parentId = input.parentId
    if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder
    if (Object.keys(values).length === 0) return current

    try {
      await db.update(categories).set(values).where(eq(categories.id, id))
      return getCategory(postTypeId, id)
    } catch (error) {
      throwTaxonomyConflict(error, 'Category slug already exists')
    }
  }

  async function deleteCategory(postTypeId: number, id: number): Promise<void> {
    await getCategory(postTypeId, id)
    await db.delete(categories).where(eq(categories.id, id))
  }

  async function getTag(id: number) {
    const tag = await db.query.tags.findFirst({ where: eq(tags.id, id) })
    if (!tag) throw KansoError.notFound('Tag')
    return tag
  }

  async function listTags(query?: string) {
    return db.query.tags.findMany({
      where: query ? searchTags(query) : undefined,
      orderBy: [asc(tags.name), asc(tags.id)],
    })
  }

  async function assertTagSlugAvailable(slug: string, excludeId?: number) {
    const tag = await db.query.tags.findFirst({
      where: eq(tags.slug, slug),
      columns: { id: true },
    })
    if (tag && tag.id !== excludeId) throw KansoError.conflict('Tag slug already exists')
  }

  async function createTag(input: CreateTagInput) {
    await assertTagSlugAvailable(input.slug)
    try {
      const [created] = await db.insert(tags).values(input).returning({ id: tags.id })
      if (!created) throw new Error('Tag insert did not return a row')
      return getTag(created.id)
    } catch (error) {
      throwTaxonomyConflict(error, 'Tag slug already exists')
    }
  }

  async function updateTag(id: number, input: UpdateTagInput) {
    const current = await getTag(id)
    await assertTagSlugAvailable(input.slug ?? current.slug, id)
    if (Object.keys(input).length === 0) return current
    try {
      await db.update(tags).set(input).where(eq(tags.id, id))
      return getTag(id)
    } catch (error) {
      throwTaxonomyConflict(error, 'Tag slug already exists')
    }
  }

  async function deleteTag(id: number): Promise<void> {
    await getTag(id)
    await db.delete(tags).where(eq(tags.id, id))
  }

  return {
    findCategoryBySlug,
    findTagBySlug,
    listCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    listTags,
    createTag,
    updateTag,
    deleteTag,
  }
}

export type TaxonomiesService = ReturnType<typeof taxonomiesService>
