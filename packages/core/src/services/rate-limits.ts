import { sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { rateLimits } from '../db/schema/index.ts'

export type RateLimitRule = {
  /** Requests allowed per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

export type RateLimitResult = {
  allowed: boolean
  /** Requests counted in the current window, this one included. */
  count: number
  /** Seconds until the window resets. */
  retryAfter: number
}

/**
 * Fixed-window counters kept in D1 (no KV or Durable Object, see Phase 13).
 * One `hit` is a single upsert: a new window resets the count to 1, the same
 * window adds 1, and `RETURNING` hands back the result without a second query.
 */
export function rateLimitsService(db: Db) {
  async function hit(key: string, rule: RateLimitRule, now = new Date()): Promise<RateLimitResult> {
    const nowSeconds = Math.floor(now.getTime() / 1000)
    const windowStart = nowSeconds - (nowSeconds % rule.windowSeconds)
    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.windowStart} = excluded.window_start then ${rateLimits.count} + 1 else 1 end`,
          windowStart: sql`excluded.window_start`,
        },
      })
      .returning({ count: rateLimits.count })
    const count = row?.count ?? 1
    return {
      allowed: count <= rule.limit,
      count,
      retryAfter: windowStart + rule.windowSeconds - nowSeconds,
    }
  }

  return { hit }
}

export type RateLimitsService = ReturnType<typeof rateLimitsService>
