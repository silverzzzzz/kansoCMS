import { KansoError } from '@kanso/core'
import { Hono } from 'hono'
import { BACKUP_PREFIX, createBackup, isBackupName, listBackups } from '../backups.ts'
import type { AppEnv } from '../env.ts'
import { requireRole } from '../middleware/auth.ts'
import { logActivity } from './activity.ts'

/**
 * The daily backups in R2 (backups.ts). Administrator sessions only: a backup
 * holds the site settings, which only an administrator may export.
 */
export const backups = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => c.json({ items: await listBackups(c.var.kanso.bucket) }))
  .post('/', async (c) => {
    const item = await createBackup(c.var.kanso)
    await logActivity(c, {
      action: 'create',
      targetType: 'backup',
      summary: `バックアップ ${item.name} を作成`,
    })
    return c.json({ item }, 201)
  })
  .get('/:name', async (c) => {
    const name = c.req.param('name')
    if (!isBackupName(name)) throw KansoError.notFound('Backup')
    const object = await c.var.kanso.bucket.get(`${BACKUP_PREFIX}${name}`)
    if (!object) throw KansoError.notFound('Backup')
    return new Response(object.body as ReadableStream, {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      },
    })
  })
