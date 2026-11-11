import { BOT_UA_PATTERN } from '@kanso/core'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env.ts'
import { hasSessionCookie } from './cache.ts'

/** Paths that answer with HTML but are not content: site search and previews. */
const EXCLUDED = /^\/(search|preview)(\/|$)/
const TIMEZONE_TTL_MS = 60_000

/**
 * The site timezone decides which day a view belongs to. It rarely changes,
 * so each isolate remembers it for a minute instead of reading it per view.
 */
let timezoneMemo: { value: string; expires: number } | null = null

async function siteTimezone(kanso: AppEnv['Variables']['kanso']): Promise<string> {
  const now = Date.now()
  if (timezoneMemo && timezoneMemo.expires > now) return timezoneMemo.value
  const { timezone } = await kanso.settings.site()
  timezoneMemo = { value: timezone, expires: now + TIMEZONE_TTL_MS }
  return timezone
}

/** Test hook: forget the remembered timezone. */
export function resetPageviewTimezone(): void {
  timezoneMemo = null
}

/**
 * Cookie-less pageview counting (T52). It must be registered **before**
 * `siteCache`: a cache hit returns without running later middleware, so
 * counting behind the cache only ever saw the misses.
 *
 * Counted: GET requests answered with 200 HTML — feeds, the maintenance 503,
 * redirects and errors drop out by themselves. Not counted: signed-in staff
 * (they would otherwise dominate a small site's numbers), bots, site search
 * and previews. The write runs in `waitUntil` and can never fail the request.
 */
export const pageviews = createMiddleware<AppEnv>(async (c, next) => {
  await next()
  if (c.req.method !== 'GET' || c.res.status !== 200) return
  if (!c.res.headers.get('content-type')?.includes('text/html')) return
  const path = c.req.path
  if (EXCLUDED.test(path) || hasSessionCookie(c)) return
  if (BOT_UA_PATTERN.test(c.req.header('user-agent') ?? '')) return

  const kanso = c.var.kanso
  const work = (async () => {
    await kanso.analytics.recordView(path, await siteTimezone(kanso))
  })().catch(() => {})
  try {
    c.executionCtx.waitUntil(work)
  } catch {
    // No ExecutionContext (non-Workers runtime): the write still proceeds.
  }
})
