import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { createPostSchema, postListQuerySchema, updatePostSchema } from '@kanso/shared'
import { type Context, Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { purgeSiteCache } from '../middleware/cache.ts'
import { postPurgePaths } from '../site/paths.ts'
import { canUseRawHtml, currentUserId } from './principal.ts'
import { idParamSchema, validationHook } from './validate.ts'

type HydratedPost = Awaited<ReturnType<AppEnv['Variables']['kanso']['posts']['getWithRelations']>>

async function purgePathsForPost(c: Context<AppEnv>, post: HydratedPost): Promise<string[]> {
  const type = await c.var.kanso.postTypes.get(post.postTypeId)
  return postPurgePaths({
    typeSlug: type.slug,
    slug: post.slug,
    categorySlugs: post.categories.map((category) => category.slug),
    tagSlugs: post.tags.map((tag) => tag.slug),
  })
}

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
    const paths = await purgePathsForPost(c, await c.var.kanso.posts.getWithRelations(item.id))
    purgeSiteCache(c, paths)
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
      const previous = await c.var.kanso.posts.getWithRelations(id)
      const item = await c.var.kanso.posts.update(id, c.req.valid('json'), {
        allowRawHtml: canUseRawHtml(c.var.principal),
      })
      const current = await c.var.kanso.posts.getWithRelations(id)
      const [previousPaths, currentPaths] = await Promise.all([
        purgePathsForPost(c, previous),
        purgePathsForPost(c, current),
      ])
      purgeSiteCache(c, [...previousPaths, ...currentPaths])
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    const previous = await c.var.kanso.posts.getWithRelations(id)
    const paths = await purgePathsForPost(c, previous)
    await c.var.kanso.posts.delete(id)
    purgeSiteCache(c, paths)
    return c.json({ ok: true })
  })
