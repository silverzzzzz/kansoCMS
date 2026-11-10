import { desc, gte, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { pageviewDaily } from '../db/schema/analytics.ts'

/** Common crawler/bot signatures checked against the User-Agent. */
export const BOT_UA_PATTERN =
  /bot|crawler|spider|slurp|curl|wget|python-requests|httpclient|lighthouse|headless/i

/** `YYYY-MM-DD` in `timezone` — the day key used for bucketing pageviews. */
export function analyticsDayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function analyticsService(db: Db) {
  return {
    /** Upsert +1 for (today in `timezone`, `path`). Runs inside waitUntil. */
    async recordView(path: string, timezone: string) {
      const day = analyticsDayKey(new Date(), timezone)
      await db
        .insert(pageviewDaily)
        .values({ day, path, count: 1 })
        .onConflictDoUpdate({
          target: [pageviewDaily.day, pageviewDaily.path],
          set: { count: sql`${pageviewDaily.count} + 1` },
        })
    },

    /**
     * Totals for the last `days` days (ending today, `timezone`): per-day sums
     * for the chart and the top 20 paths for the ranking.
     */
    async summary(days: number, timezone: string) {
      const from = analyticsDayKey(new Date(Date.now() - (days - 1) * 86_400_000), timezone)
      const [daily, top] = await Promise.all([
        db
          .select({ day: pageviewDaily.day, count: sql<number>`sum(${pageviewDaily.count})` })
          .from(pageviewDaily)
          .where(gte(pageviewDaily.day, from))
          .groupBy(pageviewDaily.day)
          .orderBy(pageviewDaily.day),
        db
          .select({ path: pageviewDaily.path, count: sql<number>`sum(${pageviewDaily.count})` })
          .from(pageviewDaily)
          .where(gte(pageviewDaily.day, from))
          .groupBy(pageviewDaily.path)
          .orderBy(desc(sql`sum(${pageviewDaily.count})`))
          .limit(20),
      ])
      return { daily, top }
    },
  }
}
