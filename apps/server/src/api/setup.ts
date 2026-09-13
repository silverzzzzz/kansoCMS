import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { SETTINGS_KEYS, setupSchema, siteSettingsSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { setSessionCookie } from './auth.ts'
import { validationHook } from './validate.ts'

export const setup = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ needed: (await c.var.kanso.auth.countUsers()) === 0 }))
  .post('/', zValidator('json', setupSchema, validationHook), async (c) => {
    if ((await c.var.kanso.auth.countUsers()) > 0) {
      throw KansoError.conflict('Setup has already been completed')
    }

    const input = c.req.valid('json')
    const user = await c.var.kanso.auth.createUser({ ...input, role: 'admin' })

    if (input.siteTitle) {
      const site = await c.var.kanso.settings.site()
      await c.var.kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, {
        ...site,
        title: input.siteTitle,
      })
    }

    const session = await c.var.kanso.auth.createSession(user.id)
    setSessionCookie(c, session.token)
    return c.json({ user })
  })
