import { zValidator } from '@hono/zod-validator'
import {
  createCategorySchema,
  createPostTypeSchema,
  idSchema,
  updateCategorySchema,
  updatePostTypeSchema,
} from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { purgeSiteCache } from '../middleware/cache.ts'
import { postTypePurgePaths } from '../site/paths.ts'
import { idParamSchema, validationHook } from './validate.ts'

const typeIdParamSchema = z.object({ typeId: idSchema })
const categoryParamSchema = z.object({ typeId: idSchema, id: idSchema })

export const postTypes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ items: await c.var.kanso.postTypes.list() }))
  .post('/', zValidator('json', createPostTypeSchema, validationHook), async (c) => {
    const item = await c.var.kanso.postTypes.create(c.req.valid('json'))
    return c.json({ item }, 201)
  })
  .get('/:typeId/categories', zValidator('param', typeIdParamSchema, validationHook), async (c) => {
    const items = await c.var.kanso.taxonomies.listCategories(c.req.valid('param').typeId)
    return c.json({ items })
  })
  .post(
    '/:typeId/categories',
    zValidator('param', typeIdParamSchema, validationHook),
    zValidator('json', createCategorySchema, validationHook),
    async (c) => {
      const item = await c.var.kanso.taxonomies.createCategory(
        c.req.valid('param').typeId,
        c.req.valid('json'),
      )
      return c.json({ item }, 201)
    },
  )
  .patch(
    '/:typeId/categories/:id',
    zValidator('param', categoryParamSchema, validationHook),
    zValidator('json', updateCategorySchema, validationHook),
    async (c) => {
      const param = c.req.valid('param')
      const item = await c.var.kanso.taxonomies.updateCategory(
        param.typeId,
        param.id,
        c.req.valid('json'),
      )
      return c.json({ item })
    },
  )
  .delete(
    '/:typeId/categories/:id',
    zValidator('param', categoryParamSchema, validationHook),
    async (c) => {
      const param = c.req.valid('param')
      await c.var.kanso.taxonomies.deleteCategory(param.typeId, param.id)
      return c.json({ ok: true })
    },
  )
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: await c.var.kanso.postTypes.get(c.req.valid('param').id) })
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updatePostTypeSchema, validationHook),
    async (c) => {
      const id = c.req.valid('param').id
      const previous = await c.var.kanso.postTypes.get(id)
      const item = await c.var.kanso.postTypes.update(id, c.req.valid('json'))
      purgeSiteCache(c, [...postTypePurgePaths(previous.slug), ...postTypePurgePaths(item.slug)])
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    const id = c.req.valid('param').id
    const previous = await c.var.kanso.postTypes.get(id)
    await c.var.kanso.postTypes.delete(id)
    purgeSiteCache(c, postTypePurgePaths(previous.slug))
    return c.json({ ok: true })
  })
