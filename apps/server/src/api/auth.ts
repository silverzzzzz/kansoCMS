import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { loginSchema, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@kanso/shared'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../env.ts'
import { requireAuth } from '../middleware/auth.ts'
import { validationHook } from './validate.ts'

function cookieOptions(c: Context<AppEnv>) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: SESSION_TTL_SECONDS,
  }
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c))
}

export const auth = new Hono<AppEnv>()
  .post('/login', zValidator('json', loginSchema, validationHook), async (c) => {
    const input = c.req.valid('json')
    const user = await c.var.kanso.auth.verifyCredentials(input.email, input.password)
    if (!user) throw KansoError.unauthorized('Invalid email or password')

    const session = await c.var.kanso.auth.createSession(user.id)
    setSessionCookie(c, session.token)
    return c.json({ user })
  })
  .post('/logout', requireAuth(), async (c) => {
    const principal = c.var.principal
    if (principal?.kind !== 'session') throw KansoError.unauthorized()

    await c.var.kanso.auth.deleteSession(principal.token)
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c))
    return c.json({ ok: true })
  })
  .get('/me', requireAuth('read'), (c) => {
    const principal = c.var.principal
    if (!principal) throw KansoError.unauthorized()

    if (principal.kind === 'session') {
      return c.json({ principal: { kind: 'session' as const, user: principal.user } })
    }
    return c.json({
      principal: {
        kind: 'apiKey' as const,
        name: principal.apiKey.name,
        scope: principal.apiKey.scope,
      },
    })
  })
