import {
  type CreateRedirectInput,
  createRedirectSchema,
  normalizeRedirectPath,
  parseRedirectCsv,
  type UpdateRedirectInput,
} from '@kanso/shared'
import type { SQL } from 'drizzle-orm'
import { asc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { redirects } from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'

function searchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}

function searchRedirects(query: string): SQL | undefined {
  const pattern = searchPattern(query)
  return or(
    sql`${redirects.fromPath} like ${pattern} escape ${'\\'}`,
    sql`${redirects.to} like ${pattern} escape ${'\\'}`,
  )
}

function throwRedirectConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw KansoError.conflict('Redirect path already exists')
  }
  throw error
}

function targetEqualsSource(fromPath: string, to: string): boolean {
  return to.startsWith('/') && normalizeRedirectPath(to) === fromPath
}

export function redirectsService(db: Db) {
  async function list(query?: string) {
    return db.query.redirects.findMany({
      where: query ? searchRedirects(query) : undefined,
      orderBy: [asc(redirects.fromPath)],
    })
  }

  async function get(id: number) {
    const redirect = await db.query.redirects.findFirst({ where: eq(redirects.id, id) })
    if (!redirect) throw KansoError.notFound('Redirect')
    return redirect
  }

  async function create(input: CreateRedirectInput) {
    try {
      const [created] = await db.insert(redirects).values(input).returning({ id: redirects.id })
      if (!created) throw new Error('Redirect insert did not return a row')
      return get(created.id)
    } catch (error) {
      throwRedirectConflict(error)
    }
  }

  async function update(id: number, input: UpdateRedirectInput) {
    const current = await get(id)
    const fromPath = input.fromPath ?? current.fromPath
    const to = input.to ?? current.to
    if (targetEqualsSource(fromPath, to)) {
      throw KansoError.validation('Redirect target equals its source')
    }
    if (Object.keys(input).length === 0) return current

    try {
      await db
        .update(redirects)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(redirects.id, id))
      return get(id)
    } catch (error) {
      throwRedirectConflict(error)
    }
  }

  async function deleteRedirect(id: number): Promise<void> {
    await get(id)
    await db.delete(redirects).where(eq(redirects.id, id))
  }

  /**
   * Bulk-upsert `from,to[,status]` CSV rows. Existing `fromPath` rows are
   * overwritten (counted as `updated`); invalid lines are reported and skipped.
   */
  async function importRows(csv: string) {
    const { rows, truncated } = parseRedirectCsv(csv)
    const errors: { line: number; message: string }[] = []
    const valid: CreateRedirectInput[] = []
    for (const row of rows) {
      const parsed = createRedirectSchema.safeParse({
        fromPath: row.fromPath,
        to: row.to,
        status: row.status === '' ? 301 : Number(row.status),
      })
      if (!parsed.success) {
        errors.push({
          line: row.line,
          message: parsed.error.issues[0]?.message ?? 'Invalid row',
        })
        continue
      }
      valid.push(parsed.data)
    }
    // Later CSV rows win, matching the overwrite-on-duplicate rule.
    const deduped = [...new Map(valid.map((row) => [row.fromPath, row])).values()]

    let created = 0
    let updated = 0
    if (deduped.length > 0) {
      const existing = new Set(
        (
          await db
            .select({ fromPath: redirects.fromPath })
            .from(redirects)
            .where(
              inArray(
                redirects.fromPath,
                deduped.map((row) => row.fromPath),
              ),
            )
        ).map((row) => row.fromPath),
      )
      const now = new Date()
      const statements = deduped.map((row) => {
        if (existing.has(row.fromPath)) updated += 1
        else created += 1
        return db
          .insert(redirects)
          .values(row)
          .onConflictDoUpdate({
            target: redirects.fromPath,
            set: { to: row.to, status: row.status, updatedAt: now },
          })
      })
      for (let offset = 0; offset < statements.length; offset += 100) {
        const [first, ...rest] = statements.slice(offset, offset + 100)
        if (first) await db.batch([first, ...rest])
      }
    }
    return { created, updated, errors, truncated }
  }

  async function findByPath(path: string) {
    const redirect = await db.query.redirects.findFirst({
      where: eq(redirects.fromPath, normalizeRedirectPath(path)),
      columns: { to: true, status: true },
    })
    return redirect ?? null
  }

  function pathChangeStatements(oldPath: string, newPath: string) {
    if (oldPath === newPath) return []
    const now = new Date()
    const to = `/${newPath}`
    return [
      db.delete(redirects).where(eq(redirects.fromPath, newPath)),
      db
        .update(redirects)
        .set({ to, updatedAt: now })
        .where(eq(redirects.to, `/${oldPath}`)),
      db
        .insert(redirects)
        .values({ fromPath: oldPath, to, status: 301 })
        .onConflictDoUpdate({
          target: redirects.fromPath,
          set: { to, status: 301, updatedAt: now },
        }),
    ]
  }

  return {
    list,
    get,
    create,
    update,
    delete: deleteRedirect,
    importRows,
    findByPath,
    pathChangeStatements,
  }
}

export type RedirectsService = ReturnType<typeof redirectsService>
