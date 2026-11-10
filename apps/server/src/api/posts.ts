import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { createPostSchema, postListQuerySchema, updatePostSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { logActivity } from './activity.ts'
import { canUseRawHtml, currentUserId } from './principal.ts'
import { idParamSchema, revisionParamSchema, validationHook } from './validate.ts'

export const posts = new Hono<AppEnv>()
  .get('/', zValidator('query', postListQuerySchema, validationHook), async (c) => {
    const query = c.req.valid('query')
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    let postTypeId: number | undefined
    if (query.type) {
      const postType = await c.var.kanso.postTypes.findBySlug(query.type)
      if (!postType) throw KansoError.notFound('Post type')
      postTypeId = postType.id
    }
    const result = await c.var.kanso.posts.list({ ...query, postTypeId })
    return c.json({ ...result, page, perPage })
  })
  .post('/', zValidator('json', createPostSchema, validationHook), async (c) => {
    const item = await c.var.kanso.posts.create(c.req.valid('json'), {
      allowRawHtml: canUseRawHtml(c.var.principal),
      authorId: currentUserId(c.var.principal),
    })
    await logActivity(c, {
      action: 'create',
      targetType: 'post',
      targetId: item.id,
      summary: `投稿「${item.title}」を作成`,
    })
    return c.json({ item }, 201)
  })
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: await c.var.kanso.posts.get(c.req.valid('param').id) })
  })
  .get('/:id/revisions', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.posts.get(id)
    return c.json({ items: await c.var.kanso.revisions.list('post', id) })
  })
  .get(
    '/:id/revisions/:revisionId',
    zValidator('param', revisionParamSchema, validationHook),
    async (c) => {
      const { id, revisionId } = c.req.valid('param')
      return c.json({ item: await c.var.kanso.revisions.get('post', id, revisionId) })
    },
  )
  .post(
    '/:id/revisions/:revisionId/restore',
    zValidator('param', revisionParamSchema, validationHook),
    async (c) => {
      const { id, revisionId } = c.req.valid('param')
      const item = await c.var.kanso.posts.restoreRevision(id, revisionId, {
        allowRawHtml: canUseRawHtml(c.var.principal),
        userId: currentUserId(c.var.principal),
      })
      await logActivity(c, {
        action: 'restore_revision',
        targetType: 'post',
        targetId: id,
        summary: `投稿「${item.title}」をリビジョン #${revisionId} へ復元`,
      })
      return c.json({ item })
    },
  )
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updatePostSchema, validationHook),
    async (c) => {
      const id = c.req.valid('param').id
      const item = await c.var.kanso.posts.update(id, c.req.valid('json'), {
        allowRawHtml: canUseRawHtml(c.var.principal),
        userId: currentUserId(c.var.principal),
      })
      await logActivity(c, {
        action: 'update',
        targetType: 'post',
        targetId: id,
        summary: `投稿「${item.title}」を更新`,
      })
      return c.json({ item })
    },
  )
  .delete(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('query', z.object({ force: z.enum(['true', 'false']).optional() }), validationHook),
    async (c) => {
      const id = c.req.valid('param').id
      const force = c.req.valid('query').force === 'true'
      await c.var.kanso.posts.delete(id, { force })
      await logActivity(c, {
        action: force ? 'purge' : 'trash',
        targetType: 'post',
        targetId: id,
        summary: force ? `投稿 #${id} を完全削除` : `投稿 #${id} をゴミ箱へ`,
      })
      return c.json({ ok: true })
    },
  )
  .post('/:id/restore', zValidator('param', idParamSchema, validationHook), async (c) => {
    const item = await c.var.kanso.posts.restore(c.req.valid('param').id)
    await logActivity(c, {
      action: 'restore',
      targetType: 'post',
      targetId: item.id,
      summary: `投稿「${item.title}」を復元`,
    })
    return c.json({ item })
  })
  .post('/:id/duplicate', zValidator('param', idParamSchema, validationHook), async (c) => {
    const item = await c.var.kanso.posts.duplicate(c.req.valid('param').id, {
      allowRawHtml: canUseRawHtml(c.var.principal),
      authorId: currentUserId(c.var.principal),
    })
    await logActivity(c, {
      action: 'duplicate',
      targetType: 'post',
      targetId: item.id,
      summary: `投稿「${item.title}」を複製`,
    })
    return c.json({ item }, 201)
  })
  .get('/:id/share-links', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.posts.get(id)
    return c.json({ items: await c.var.kanso.shareLinks.listFor('post', id) })
  })
  .post('/:id/share-links', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.posts.get(id)
    const link = await c.var.kanso.shareLinks.create({
      targetType: 'post',
      targetId: id,
      createdBy: currentUserId(c.var.principal),
    })
    await logActivity(c, {
      action: 'create',
      targetType: 'share_link',
      targetId: link.id,
      summary: `投稿 #${id} の共有リンクを作成`,
    })
    const base = c.env.SITE_URL || new URL(c.req.url).origin
    return c.json(
      {
        item: {
          id: link.id,
          expiresAt: link.expiresAt,
          url: new URL(`/preview/share/${link.token}`, base).toString(),
        },
      },
      201,
    )
  })
