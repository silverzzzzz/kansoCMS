import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { SETTINGS_KEYS, setupSchema, siteSettingsSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { bumpSiteCacheVersion } from '../middleware/cache.ts'
import { starterImageLoader } from '../starter/assets.ts'
import { installStarter } from '../starter/install.ts'
import { setSessionCookie } from './auth.ts'
import { validationHook } from './validate.ts'

type StarterOutcome = { installed: boolean; error: string | null }

export const setup = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ needed: (await c.var.kanso.auth.countUsers()) === 0 }))
  // Setup changes what the public site shows (site title, starter content), so
  // it rotates the cache generation like the protected write routes do.
  .post('/', bumpSiteCacheVersion, zValidator('json', setupSchema, validationHook), async (c) => {
    if ((await c.var.kanso.auth.countUsers()) > 0) {
      throw KansoError.conflict('Setup has already been completed')
    }

    const input = c.req.valid('json')
    const user = await c.var.kanso.auth.createUser({
      email: input.email,
      password: input.password,
      name: input.name,
      role: 'admin',
    })

    if (input.siteTitle) {
      const site = await c.var.kanso.settings.site()
      await c.var.kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, {
        ...site,
        title: input.siteTitle,
      })
    }

    // The starter site is a convenience: failing to install it must not fail
    // setup, since the admin can retry from the settings screen.
    let starter: StarterOutcome | null = null
    if (input.starter) {
      try {
        await installStarter(c.var.kanso, {
          userId: user.id,
          loadImage: starterImageLoader(c.env, c.req.url),
        })
        starter = { installed: true, error: null }
      } catch (error) {
        console.error('Starter site install failed during setup', error)
        starter = {
          installed: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    const session = await c.var.kanso.auth.createSession(user.id)
    setSessionCookie(c, session.token)
    return c.json({ user, starter })
  })
