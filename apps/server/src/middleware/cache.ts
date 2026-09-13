import { SESSION_COOKIE } from '@kanso/shared'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env.ts'

interface SiteCacheApi {
  match(request: string): Promise<Response | undefined>
  put(request: string, response: Response): Promise<void>
  delete(request: string): Promise<boolean>
}

function isSiteCacheApi(value: unknown): value is SiteCacheApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'match' in value &&
    typeof value.match === 'function' &&
    'put' in value &&
    typeof value.put === 'function' &&
    'delete' in value &&
    typeof value.delete === 'function'
  )
}

function defaultCache(): SiteCacheApi | null {
  if (typeof caches === 'undefined') return null
  const storage: object = caches
  if (!('default' in storage)) return null
  return isSiteCacheApi(storage.default) ? storage.default : null
}

export function siteCacheKey(url: string): string {
  const source = new URL(url)
  const key = new URL(source.pathname, source.origin)
  if (source.searchParams.has('page'))
    key.searchParams.set('page', source.searchParams.get('page') ?? '')
  return key.toString()
}

function hasSessionCookie(c: Context<AppEnv>): boolean {
  return (c.req.header('Cookie') ?? '')
    .split(';')
    .some((part) => part.trimStart().startsWith(`${SESSION_COOKIE}=`))
}

export const siteCache = createMiddleware<AppEnv>(async (c, next) => {
  const cache = defaultCache()
  if (
    c.req.method !== 'GET' ||
    hasSessionCookie(c) ||
    c.req.path.startsWith('/preview/') ||
    !cache
  ) {
    await next()
    return
  }

  const key = siteCacheKey(c.req.url)
  try {
    const hit = await cache.match(key)
    if (hit) {
      const response = new Response(hit.body, hit)
      response.headers.set('x-kanso-cache', 'HIT')
      return response
    }
  } catch {
    await next()
    return
  }

  await next()
  if (c.res.status !== 200) {
    c.header('x-kanso-cache', 'BYPASS')
    return
  }

  c.header('cache-control', 'public, s-maxage=60')
  c.header('x-kanso-cache', 'MISS')
  try {
    c.executionCtx.waitUntil(cache.put(key, c.res.clone()).catch(() => undefined))
  } catch {
    // Cache failures must never fail the site response.
  }
})

export function purgeSiteCache(c: Context<AppEnv>, paths: string[]): void {
  const cache = defaultCache()
  if (!cache) return
  try {
    const origins = new Set([c.env.SITE_URL, new URL(c.req.url).origin])
    const urls = [...origins].flatMap((origin) =>
      [...new Set(paths)].map((path) => new URL(path, `${origin}/`).toString()),
    )
    c.executionCtx.waitUntil(
      Promise.allSettled(urls.map((url) => cache.delete(url))).then(() => undefined),
    )
  } catch {
    // Cache failures must never fail a mutation response.
  }
}
