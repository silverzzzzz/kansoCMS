import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { exportQuerySchema, importBundleSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { turnstileConfig } from '../forms/turnstile.ts'
import { requireAuth } from '../middleware/auth.ts'
import { sectionFieldsOf } from '../site/themes/sections-meta.ts'
import { logActivity } from './activity.ts'
import { canUseRawHtml, currentUserId, isAdminSession } from './principal.ts'
import { validationHook } from './validate.ts'

/**
 * Content export/import. `GET /export` is a read operation but requires the
 * write scope — it exfiltrates the whole site. `POST /import` upserts by
 * slug/path and reports counts plus per-item warnings.
 *
 * Site settings are administrator-only on every other route (`/settings`),
 * and they include raw HTML injected into every page — so both directions
 * treat them the same way here: only an administrator's session may export
 * or import them. Anyone else's import still brings in the content.
 */
export const transfer = new Hono<AppEnv>()
  .get(
    '/export',
    requireAuth('write'),
    zValidator('query', exportQuerySchema, validationHook),
    async (c) => {
      const withSettings = c.req.valid('query').settings === '1'
      if (withSettings && !isAdminSession(c.var.principal)) {
        throw KansoError.forbidden('Only an administrator can export settings')
      }
      const bundle = await c.var.kanso.transfer.export({
        settings: withSettings,
        sectionFields: sectionFieldsOf,
      })
      const day = bundle.exportedAt.slice(0, 10)
      c.header('content-disposition', `attachment; filename="kanso-export-${day}.json"`)
      return c.json(bundle)
    },
  )
  .post('/import', zValidator('json', importBundleSchema, validationHook), async (c) => {
    const report = await c.var.kanso.transfer.import(c.req.valid('json'), {
      allowRawHtml: canUseRawHtml(c.var.principal),
      userId: currentUserId(c.var.principal),
      canImportSettings: isAdminSession(c.var.principal),
      turnstileAvailable: (await turnstileConfig(c)) !== null,
      sectionFields: sectionFieldsOf,
    })
    await logActivity(c, {
      action: 'import',
      targetType: 'import',
      summary: `JSON インポート (新規 ${report.created}・更新 ${report.updated} 件)`,
    })
    return c.json(report)
  })
