import type { Kanso } from '@kanso/core'
import { type StarterManifest, starterCounts } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { requireRole } from '../middleware/auth.ts'
import { starterImageLoader } from '../starter/assets.ts'
import { installStarter } from '../starter/install.ts'
import { logActivity } from './activity.ts'
import { currentUserId } from './principal.ts'

/** The starter home page, while it still exists, for the dashboard's customize link. */
async function starterHomePageId(kanso: Kanso, manifest: StarterManifest): Promise<number | null> {
  for (const id of manifest.pages) {
    const page = await kanso.pages.get(id).catch(() => null)
    if (page?.path === 'home') return page.id
  }
  return null
}

export const starter = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => {
    const manifest = await c.var.kanso.settings.starter()
    if (!manifest) return c.json({ installed: false as const })
    return c.json({
      installed: true as const,
      installedAt: manifest.installedAt,
      counts: starterCounts(manifest),
      homePageId: await starterHomePageId(c.var.kanso, manifest),
    })
  })
  .post('/', async (c) => {
    const result = await installStarter(c.var.kanso, {
      userId: currentUserId(c.var.principal),
      loadImage: starterImageLoader(c.env, c.req.url),
    })
    await logActivity(c, {
      action: 'create',
      targetType: 'starter',
      summary: 'スターターコンテンツをインストール',
    })
    return c.json(result, 201)
  })
  .delete('/', async (c) => {
    const result = await c.var.kanso.starter.remove()
    await logActivity(c, {
      action: 'delete',
      targetType: 'starter',
      summary: 'スターターコンテンツを削除',
    })
    return c.json(result)
  })
