import type { CreateMenuInput, UpdateMenuInput } from '@kanso/shared'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { menus } from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'

function throwMenuConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw KansoError.conflict('Menu slug already exists')
  }
  throw error
}

export function menusService(db: Db) {
  async function list() {
    return db.query.menus.findMany({ orderBy: [asc(menus.name), asc(menus.id)] })
  }

  async function get(id: number) {
    const menu = await db.query.menus.findFirst({ where: eq(menus.id, id) })
    if (!menu) throw KansoError.notFound('Menu')
    return menu
  }

  async function findBySlug(slug: string) {
    const menu = await db.query.menus.findFirst({ where: eq(menus.slug, slug) })
    return menu ?? null
  }

  async function create(input: CreateMenuInput) {
    try {
      const [created] = await db
        .insert(menus)
        .values({ slug: input.slug, name: input.name, itemsJson: input.items ?? [] })
        .returning({ id: menus.id })
      if (!created) throw new Error('Menu insert did not return a row')
      return get(created.id)
    } catch (error) {
      throwMenuConflict(error)
    }
  }

  async function update(id: number, input: UpdateMenuInput) {
    const current = await get(id)
    if (Object.keys(input).length === 0) return current
    const values: Record<string, unknown> = { updatedAt: new Date() }
    if (input.slug !== undefined) values.slug = input.slug
    if (input.name !== undefined) values.name = input.name
    if (input.items !== undefined) values.itemsJson = input.items
    try {
      await db.update(menus).set(values).where(eq(menus.id, id))
      return get(id)
    } catch (error) {
      throwMenuConflict(error)
    }
  }

  async function deleteMenu(id: number): Promise<void> {
    await get(id)
    await db.delete(menus).where(eq(menus.id, id))
  }

  return { list, get, findBySlug, create, update, delete: deleteMenu }
}

export type MenusService = ReturnType<typeof menusService>
