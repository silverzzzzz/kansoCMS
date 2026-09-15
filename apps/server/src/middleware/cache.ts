import { SESSION_COOKIE } from '@kanso/shared'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env.ts'

interface SiteCacheApi {
  match(request: string): Promise<Response | undefined>
  put(request: string, response: Response): Promise<void>
}

function isSiteCacheApi(value: unknown): value is SiteCacheApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'match' in value &&
    typeof value.match === 'function' &&
    'put' in value &&
    typeof value.put === 'function'
  )
}

function defaultCache(): SiteCacheApi | null {
  if (typeof caches === 'undefined') return null
  const storage: object = caches
  if (!('default' in storage)) return null
  return isSiteCacheApi(storage.default) ? storage.default : null
}

export function siteCacheKey(url: string, version: string): string {
  const source = new URL(url)
  const key = new URL(source.pathname, source.origin)
  if (source.searchParams.has('page'))
    key.searchParams.set('page', source.searchParams.get('page') ?? '')
  key.searchParams.set('__v', version)
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

  let key: string
  try {
    const version = await c.var.kanso.cacheVersion.get()
    key = siteCacheKey(c.req.url, version)
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

/** Rotates the public-site cache generation after a successful mutation. Awaited so the next GET sees it. */
export const bumpSiteCacheVersion = createMiddleware<AppEnv>(async (c, next) => {
  await next()
  if (c.res.ok) await c.var.kanso.cacheVersion.bump()
})
