import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import {
  addPasskeySchema,
  finishPasskeyLinkSchema,
  passkeyLinkSchema,
  passkeyLoginSchema,
  renamePasskeySchema,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@kanso/shared'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../env.ts'
import { requireAuth, requireSession, sessionUser } from '../middleware/auth.ts'
import { relyingParty } from './relying-party.ts'
import { idParamSchema, validationHook } from './validate.ts'

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

export async function startSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const session = await c.var.kanso.auth.createSession(userId)
  setSessionCookie(c, session.token)
}

async function siteRelyingParty(c: Context<AppEnv>) {
  return relyingParty(c, (await c.var.kanso.settings.site()).title)
}

/**
 * Sign-in is passkey only. Each options endpoint issues a single-use
 * challenge; the matching POST verifies the browser's answer to it.
 */
export const auth = new Hono<AppEnv>()
  .post('/passkey/options', async (c) =>
    c.json({ options: await c.var.kanso.passkeys.loginOptions(relyingParty(c)) }),
  )
  .post('/passkey', zValidator('json', passkeyLoginSchema, validationHook), async (c) => {
    const { credential } = c.req.valid('json')
    const user = await c.var.kanso.passkeys.finishLogin(credential, relyingParty(c))
    await startSession(c, user.id)
    return c.json({ user })
  })
  .post(
    '/passkey-link/options',
    zValidator('json', passkeyLinkSchema, validationHook),
    async (c) => {
      const { token } = c.req.valid('json')
      return c.json(await c.var.kanso.passkeys.linkOptions(token, await siteRelyingParty(c)))
    },
  )
  .post('/passkey-link', zValidator('json', finishPasskeyLinkSchema, validationHook), async (c) => {
    const { token, credential, passkeyName } = c.req.valid('json')
    const user = await c.var.kanso.passkeys.finishLink(
      token,
      credential,
      relyingParty(c),
      passkeyName,
    )
    await startSession(c, user.id)
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
  .get('/passkeys', requireSession, async (c) =>
    c.json({ items: await c.var.kanso.passkeys.list(sessionUser(c).id) }),
  )
  .post('/passkeys/options', requireSession, async (c) =>
    c.json({
      options: await c.var.kanso.passkeys.registerOptions(
        sessionUser(c).id,
        await siteRelyingParty(c),
      ),
    }),
  )
  .post(
    '/passkeys',
    requireSession,
    zValidator('json', addPasskeySchema, validationHook),
    async (c) => {
      const { credential, name } = c.req.valid('json')
      const item = await c.var.kanso.passkeys.finishRegister(
        sessionUser(c).id,
        credential,
        relyingParty(c),
        name,
      )
      return c.json({ item }, 201)
    },
  )
  .patch(
    '/passkeys/:id',
    requireSession,
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', renamePasskeySchema, validationHook),
    async (c) => {
      const item = await c.var.kanso.passkeys.rename(
        sessionUser(c).id,
        c.req.valid('param').id,
        c.req.valid('json').name,
      )
      return c.json({ item })
    },
  )
  .delete(
    '/passkeys/:id',
    requireSession,
    zValidator('param', idParamSchema, validationHook),
    async (c) => {
      await c.var.kanso.passkeys.remove(sessionUser(c).id, c.req.valid('param').id)
      return c.json({ ok: true })
    },
  )
