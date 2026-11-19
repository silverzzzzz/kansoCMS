import { NOT_FOUND_MAX_PATH_LENGTH, NOT_FOUND_PER_PAGE, normalizeRedirectPath } from '@kanso/shared'
import { count, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { notFoundPaths } from '../db/schema/index.ts'

/** Paths that answered 404 on the public site, for the redirects screen. */
export function notFoundService(db: Db) {
  /**
   * Counts one 404. One upsert; the caller runs it after the response
   * (`waitUntil`). Empty and overlong paths are ignored.
   */
  async function record(rawPath: string, now = new Date()): Promise<void> {
    const path = normalizeRedirectPath(rawPath)
    if (path === '' || path.length > NOT_FOUND_MAX_PATH_LENGTH) return
    const seconds = Math.floor(now.getTime() / 1000)
    await db
      .insert(notFoundPaths)
      .values({ path, count: 1, firstSeen: seconds, lastSeen: seconds })
      .onConflictDoUpdate({
        target: notFoundPaths.path,
        set: { count: sql`${notFoundPaths.count} + 1`, lastSeen: seconds },
      })
  }

  async function list(page = 1) {
    const [items, [total]] = await Promise.all([
      db
        .select()
        .from(notFoundPaths)
        .orderBy(desc(notFoundPaths.count), desc(notFoundPaths.lastSeen))
        .limit(NOT_FOUND_PER_PAGE)
        .offset((page - 1) * NOT_FOUND_PER_PAGE),
      db.select({ total: count() }).from(notFoundPaths),
    ])
    return {
      items: items.map((row) => ({
        path: row.path,
        count: row.count,
        firstSeen: new Date(row.firstSeen * 1000).toISOString(),
        lastSeen: new Date(row.lastSeen * 1000).toISOString(),
      })),
      total: total?.total ?? 0,
    }
  }

  /** Forget one path, or all of them without one. */
  async function dismiss(path?: string): Promise<void> {
    if (path === undefined) await db.delete(notFoundPaths)
    else await db.delete(notFoundPaths).where(eq(notFoundPaths.path, normalizeRedirectPath(path)))
  }

  return { record, list, dismiss }
}

export type NotFoundService = ReturnType<typeof notFoundService>
