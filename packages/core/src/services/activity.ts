import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { activityLog } from '../db/schema/index.ts'

/** Oldest rows beyond this cap are pruned on every insert. */
export const ACTIVITY_LOG_MAX_ROWS = 2000
export const ACTIVITY_LIST_MAX_LIMIT = 200
/** Failed sign-ins inside this window share one log row. */
export const FAILED_SIGN_IN_WINDOW_MS = 60 * 60 * 1000
const FAILED_SIGN_IN_ACTION = 'login_failed'

export type ActivityEntry = {
  actor: string
  userId?: number | null
  action: string
  targetType: string
  targetId?: string | number | null
  summary: string
}

export function activityService(db: Db) {
  async function log(entry: ActivityEntry) {
    await db.insert(activityLog).values({
      actor: entry.actor,
      userId: entry.userId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId:
        entry.targetId === null || entry.targetId === undefined ? null : String(entry.targetId),
      summary: entry.summary,
    })

    // Prune everything older than the newest ACTIVITY_LOG_MAX_ROWS entries.
    const [cutoff] = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .orderBy(desc(activityLog.id))
      .limit(1)
      .offset(ACTIVITY_LOG_MAX_ROWS)
    if (cutoff) await db.delete(activityLog).where(lte(activityLog.id, cutoff.id))
  }

  /**
   * Record a failed sign-in. The endpoint is public, so each request must not
   * cost a row: attempts within an hour only bump the newest row's counter.
   */
  async function logFailedSignIn(summary: string, now = new Date()) {
    const latest = db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.action, FAILED_SIGN_IN_ACTION),
          gte(activityLog.createdAt, new Date(now.getTime() - FAILED_SIGN_IN_WINDOW_MS)),
        ),
      )
      .orderBy(desc(activityLog.id))
      .limit(1)
    const bumped = await db
      .update(activityLog)
      .set({ count: sql`${activityLog.count} + 1` })
      .where(inArray(activityLog.id, latest))
      .returning({ id: activityLog.id })
    if (bumped.length > 0) return
    await log({ actor: 'anonymous', action: FAILED_SIGN_IN_ACTION, targetType: 'auth', summary })
  }

  async function list(limit = 100) {
    return db.query.activityLog.findMany({
      orderBy: [desc(activityLog.id)],
      limit,
    })
  }

  async function countRows() {
    const [row] = await db.select({ value: count() }).from(activityLog)
    return row?.value ?? 0
  }

  return { log, logFailedSignIn, list, count: countRows }
}

export type ActivityService = ReturnType<typeof activityService>
