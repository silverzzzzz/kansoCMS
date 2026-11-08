import { zValidator } from '@hono/zod-validator'
import { finishSetupSchema, SETTINGS_KEYS, setupSchema, siteSettingsSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { bumpSiteCacheVersion } from '../middleware/cache.ts'
import { starterImageLoader } from '../starter/assets.ts'
import { installStarter } from '../starter/install.ts'
import { startSession } from './auth.ts'
import { relyingParty } from './relying-party.ts'
import { validationHook } from './validate.ts'

type StarterOutcome = { installed: boolean; error: string | null }

/**
 * First-run setup in two steps, both only while there are no users:
 * `POST /options` takes who the first admin is and returns passkey creation
 * options; `POST /` verifies the new passkey and creates the admin with it.
 */
export const setup = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ needed: (await c.var.kanso.auth.countUsers()) === 0 }))
  .post('/options', zValidator('json', setupSchema, validationHook), async (c) => {
    const input = c.req.valid('json')
    const name = input.siteTitle ?? (await c.var.kanso.settings.site()).title
    return c.json({
      options: await c.var.kanso.passkeys.setupOptions(input, relyingParty(c, name)),
    })
  })
  // Setup changes what the public site shows (site title, starter content), so
  // it rotates the cache generation like the protected write routes do.
  .post(
    '/',
    bumpSiteCacheVersion,
    zValidator('json', finishSetupSchema, validationHook),
    async (c) => {
      const { credential, passkeyName } = c.req.valid('json')
      const { user, setup: input } = await c.var.kanso.passkeys.finishSetup(
        credential,
        relyingParty(c),
        passkeyName,
      )

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

      await startSession(c, user.id)
      return c.json({ user, starter })
    },
  )
