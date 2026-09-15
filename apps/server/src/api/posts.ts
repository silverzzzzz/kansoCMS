import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { createPostSchema, postListQuerySchema, updatePostSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { canUseRawHtml, currentUserId } from './principal.ts'
import { idParamSchema, validationHook } from './validate.ts'

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
    return c.json({ item }, 201)
  })
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: await c.var.kanso.posts.get(c.req.valid('param').id) })
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updatePostSchema, validationHook),
    async (c) => {
      const id = c.req.valid('param').id
      const item = await c.var.kanso.posts.update(id, c.req.valid('json'), {
        allowRawHtml: canUseRawHtml(c.var.principal),
      })
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    await c.var.kanso.posts.delete(id)
    return c.json({ ok: true })
  })
