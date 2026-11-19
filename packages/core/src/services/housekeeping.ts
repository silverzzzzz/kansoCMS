import { TRASH_RETENTION_DAYS } from '@kanso/shared'
import { and, desc, eq, inArray, lt, notInArray } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import {
  authChallenges,
  notFoundPaths,
  pages,
  pageviewDaily,
  passkeyLinks,
  posts,
  rateLimits,
  revisions,
  sessions,
  shareLinks,
} from '../db/schema/index.ts'

const DAY_MS = 86_400_000
/** Daily pageview rows are kept for a little over a year (year-on-year comparisons stay possible). */
export const PAGEVIEW_RETENTION_DAYS = 400
/** Rate-limit windows are minutes long; a day-old counter can never matter again. */
const RATE_LIMIT_RETENTION_SECONDS = 86_400
/** A missing path not requested for this long is dropped from the redirects screen. */
export const NOT_FOUND_RETENTION_DAYS = 30
/** At most this many missing paths are kept (the most recently requested). */
export const NOT_FOUND_MAX_ROWS = 1000

export type HousekeepingReport = {
  pages: number
  posts: number
  shareLinks: number
  sessions: number
  passkeyLinks: number
  challenges: number
  pageviewRows: number
  rateLimitRows: number
  notFoundRows: number
}

/**
 * What the daily Cron Trigger runs: things that would otherwise only ever
 * grow. Everything is one `db.batch()`, so the job costs a single D1 round
 * trip however much there is to remove.
 */
export function housekeepingService(db: Db) {
  async function run(now = new Date()): Promise<HousekeepingReport> {
    const trashCutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS)
    const pageviewCutoff = new Date(now.getTime() - PAGEVIEW_RETENTION_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10)
    // Trashing a page trashes its live descendants in the same statement, so
    // a page past the cutoff never has a live child left to re-home.
    const stalePages = db
      .select({ id: pages.id })
      .from(pages)
      .where(lt(pages.deletedAt, trashCutoff))
    const stalePosts = db
      .select({ id: posts.id })
      .from(posts)
      .where(lt(posts.deletedAt, trashCutoff))

    const [
      ,
      ,
      purgedPages,
      ,
      ,
      purgedPosts,
      links,
      expiredSessions,
      passkeyRows,
      challenges,
      views,
      counters,
      staleMissing,
      overflowMissing,
    ] = await db.batch([
      db
        .delete(revisions)
        .where(and(eq(revisions.targetType, 'page'), inArray(revisions.targetId, stalePages))),
      db
        .delete(shareLinks)
        .where(and(eq(shareLinks.targetType, 'page'), inArray(shareLinks.targetId, stalePages))),
      db.delete(pages).where(lt(pages.deletedAt, trashCutoff)).returning({ id: pages.id }),
      db
        .delete(revisions)
        .where(and(eq(revisions.targetType, 'post'), inArray(revisions.targetId, stalePosts))),
      db
        .delete(shareLinks)
        .where(and(eq(shareLinks.targetType, 'post'), inArray(shareLinks.targetId, stalePosts))),
      db.delete(posts).where(lt(posts.deletedAt, trashCutoff)).returning({ id: posts.id }),
      db.delete(shareLinks).where(lt(shareLinks.expiresAt, now)).returning({ id: shareLinks.id }),
      db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id }),
      db
        .delete(passkeyLinks)
        .where(lt(passkeyLinks.expiresAt, now))
        .returning({ id: passkeyLinks.id }),
      db
        .delete(authChallenges)
        .where(lt(authChallenges.expiresAt, now))
        .returning({ id: authChallenges.id }),
      db
        .delete(pageviewDaily)
        .where(lt(pageviewDaily.day, pageviewCutoff))
        .returning({ day: pageviewDaily.day }),
      db
        .delete(rateLimits)
        .where(
          lt(
            rateLimits.windowStart,
            Math.floor(now.getTime() / 1000) - RATE_LIMIT_RETENTION_SECONDS,
          ),
        )
        .returning({ key: rateLimits.key }),
      db
        .delete(notFoundPaths)
        .where(
          lt(
            notFoundPaths.lastSeen,
            Math.floor(now.getTime() / 1000) - NOT_FOUND_RETENTION_DAYS * 86_400,
          ),
        )
        .returning({ path: notFoundPaths.path }),
      db
        .delete(notFoundPaths)
        .where(
          notInArray(
            notFoundPaths.path,
            db
              .select({ path: notFoundPaths.path })
              .from(notFoundPaths)
              .orderBy(desc(notFoundPaths.lastSeen))
              .limit(NOT_FOUND_MAX_ROWS),
          ),
        )
        .returning({ path: notFoundPaths.path }),
    ])

    return {
      pages: purgedPages.length,
      posts: purgedPosts.length,
      shareLinks: links.length,
      sessions: expiredSessions.length,
      passkeyLinks: passkeyRows.length,
      challenges: challenges.length,
      pageviewRows: views.length,
      rateLimitRows: counters.length,
      notFoundRows: staleMissing.length + overflowMissing.length,
    }
  }

  return { run }
}

export type HousekeepingService = ReturnType<typeof housekeepingService>
