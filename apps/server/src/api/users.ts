import { zValidator } from '@hono/zod-validator'
import { idSchema, inviteUserSchema, updateUserSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { requireRole, sessionUser } from '../middleware/auth.ts'
import { logActivity } from './activity.ts'
import { idParamSchema, validationHook } from './validate.ts'

const removeQuerySchema = z.object({ reassignTo: idSchema.optional() })

/**
 * User management, for administrators signed in to the admin (never API
 * keys). A new user gets a one-time registration link instead of a password:
 * the response carries the raw token once, and the admin UI turns it into a
 * `/_admin/passkey-link?token=…` URL on the origin the team signs in on (a
 * passkey belongs to the domain it is created on).
 */
export const users = new Hono<AppEnv>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => c.json({ items: await c.var.kanso.users.list() }))
  .post('/', zValidator('json', inviteUserSchema, validationHook), async (c) => {
    const { user, token, expiresAt } = await c.var.kanso.users.invite(c.req.valid('json'))
    await logActivity(c, {
      action: 'create',
      targetType: 'user',
      targetId: user.id,
      summary: `ユーザー「${user.name}」を招待 (${user.role === 'admin' ? '管理者' : '編集者'})`,
    })
    return c.json({ item: user, link: { token, expiresAt } }, 201)
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updateUserSchema, validationHook),
    async (c) => {
      const input = c.req.valid('json')
      const user = await c.var.kanso.users.update(c.req.valid('param').id, input)
      await logActivity(c, {
        action: 'update',
        targetType: 'user',
        targetId: user.id,
        summary:
          input.role === undefined
            ? `ユーザー「${user.name}」を更新`
            : `ユーザー「${user.name}」の権限を${user.role === 'admin' ? '管理者' : '編集者'}に変更`,
      })
      return c.json({ item: user })
    },
  )
  /** A fresh registration link: an expired invitation, or a user who lost every passkey. */
  .post('/:id/link', zValidator('param', idParamSchema, validationHook), async (c) => {
    const { user, token, expiresAt } = await c.var.kanso.users.issueLink(c.req.valid('param').id)
    await logActivity(c, {
      action: 'create',
      targetType: 'passkey_link',
      targetId: user.id,
      summary: `ユーザー「${user.name}」のパスキー登録リンクを発行`,
    })
    return c.json({ item: user, link: { token, expiresAt } }, 201)
  })
  .delete(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('query', removeQuerySchema, validationHook),
    async (c) => {
      const removed = await c.var.kanso.users.remove(c.req.valid('param').id, {
        actorId: sessionUser(c).id,
        reassignTo: c.req.valid('query').reassignTo,
      })
      await logActivity(c, {
        action: 'delete',
        targetType: 'user',
        targetId: removed.id,
        summary: `ユーザー「${removed.name}」を削除`,
      })
      return c.json({ ok: true })
    },
  )
