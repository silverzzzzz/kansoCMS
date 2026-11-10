import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { logActivity } from './activity.ts'
import { validationHook } from './validate.ts'

/** Share link ids are the token's SHA-256 hex (64 chars). */
const linkParamSchema = z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) })

export const shareLinks = new Hono<AppEnv>().delete(
  '/:id',
  zValidator('param', linkParamSchema, validationHook),
  async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.shareLinks.revoke(id)
    await logActivity(c, {
      action: 'delete',
      targetType: 'share_link',
      targetId: id,
      summary: '共有リンクを取り消し',
    })
    return c.json({ ok: true })
  },
)
