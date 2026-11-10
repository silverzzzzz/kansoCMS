import { zValidator } from '@hono/zod-validator'
import { exportBundleSchema, exportQuerySchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { requireAuth } from '../middleware/auth.ts'
import { logActivity } from './activity.ts'
import { canUseRawHtml, currentUserId } from './principal.ts'
import { validationHook } from './validate.ts'

/**
 * Content export/import. `GET /export` is a read operation but requires the
 * write scope — it exfiltrates the whole site. `POST /import` upserts by
 * slug/path and reports counts plus per-item warnings.
 */
export const transfer = new Hono<AppEnv>()
  .get(
    '/export',
    requireAuth('write'),
    zValidator('query', exportQuerySchema, validationHook),
    async (c) => {
      const bundle = await c.var.kanso.transfer.export({
        settings: c.req.valid('query').settings === '1',
      })
      const day = bundle.exportedAt.slice(0, 10)
      c.header('content-disposition', `attachment; filename="kanso-export-${day}.json"`)
      return c.json(bundle)
    },
  )
  .post('/import', zValidator('json', exportBundleSchema, validationHook), async (c) => {
    const report = await c.var.kanso.transfer.import(c.req.valid('json'), {
      allowRawHtml: canUseRawHtml(c.var.principal),
      userId: currentUserId(c.var.principal),
    })
    await logActivity(c, {
      action: 'import',
      targetType: 'import',
      summary: `JSON インポート (新規 ${report.created}・更新 ${report.updated} 件)`,
    })
    return c.json(report)
  })
