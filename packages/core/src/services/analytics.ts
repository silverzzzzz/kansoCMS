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

/**
 * The last `days` calendar days ending today in `timezone`, oldest first.
 * Stepping through UTC noon keeps the list gap-free across DST changes.
 */
export function analyticsDayKeys(days: number, timezone: string, now = new Date()): string[] {
  const [year, month, day] = analyticsDayKey(now, timezone).split('-').map(Number)
  const today = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12)
  return Array.from({ length: days }, (_, index) =>
    new Date(today - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  )
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
     * Totals for the last `days` days (ending today, `timezone`): one entry
     * per day for the chart — days without views included as 0 — and the top
     * 20 paths for the ranking.
     */
    async summary(days: number, timezone: string, now = new Date()) {
      const keys = analyticsDayKeys(days, timezone, now)
      const from = keys[0] ?? analyticsDayKey(now, timezone)
      const [rows, top] = await Promise.all([
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
      const counts = new Map(rows.map((row) => [row.day, Number(row.count)]))
      return {
        daily: keys.map((day) => ({ day, count: counts.get(day) ?? 0 })),
        top: top.map((row) => ({ path: row.path, count: Number(row.count) })),
      }
    },
  }
}
