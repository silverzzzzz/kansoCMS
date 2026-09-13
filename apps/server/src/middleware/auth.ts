import { KansoError } from '@kanso/core'
import { API_KEY_HEADER, type ApiKeyScope, type PublicUser, SESSION_COOKIE } from '@kanso/shared'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env.ts'

export type Principal =
  | { kind: 'session'; user: PublicUser; token: string }
  | { kind: 'apiKey'; apiKey: { id: number; name: string; scope: ApiKeyScope } }

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function checkCsrf(c: Context<AppEnv>): void {
  const fetchSite = c.req.header('Sec-Fetch-Site')
  if (fetchSite) {
    if (fetchSite !== 'same-origin' && fetchSite !== 'none') throw KansoError.forbidden()
    return
  }

  const origin = c.req.header('Origin')
  if (!origin) return

  try {
    if (new URL(origin).host !== c.req.header('Host')) throw KansoError.forbidden()
  } catch (error) {
    if (error instanceof KansoError) throw error
    throw KansoError.forbidden()
  }
}

export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const user = await c.var.kanso.auth.getSessionUser(token)
    if (user) c.set('principal', { kind: 'session', user, token })
  }

  if (!c.var.principal) {
    const key = c.req.header(API_KEY_HEADER)
    if (key) {
      const apiKey = await c.var.kanso.auth.verifyApiKey(key)
      if (apiKey) c.set('principal', { kind: 'apiKey', apiKey })
    }
  }

  await next()
})

export function requireAuth(scope: ApiKeyScope = 'write') {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.var.principal
    if (!principal) throw KansoError.unauthorized()

    if (principal.kind === 'apiKey') {
      if (scope === 'write' && principal.apiKey.scope !== 'write') {
        throw KansoError.forbidden()
      }
    } else if (!SAFE_METHODS.has(c.req.method)) {
      checkCsrf(c)
    }

    await next()
  })
}

export function requireRole(role: 'admin') {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.var.principal
    if (principal?.kind !== 'session' || principal.user.role !== role) {
      throw KansoError.forbidden()
    }
    await next()
  })
}
