import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { idSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { validationHook } from '../api/validate.ts'
import type { AppEnv } from '../env.ts'
import { authenticate } from '../middleware/auth.ts'
import { renderPage, renderPost } from './render.tsx'

const previewParamSchema = z.object({ kind: z.enum(['page', 'post']), id: idSchema })

export const preview = new Hono<AppEnv>()
  .use('*', authenticate)
  .get('/:kind/:id', zValidator('param', previewParamSchema, validationHook), async (c) => {
    if (c.var.principal?.kind !== 'session') throw KansoError.unauthorized()
    const { kind, id } = c.req.valid('param')
    c.header('cache-control', 'no-store')
    c.header('x-robots-tag', 'noindex')

    if (kind === 'page') return renderPage(c, await c.var.kanso.pages.get(id), { preview: true })

    const post = await c.var.kanso.posts.getWithRelations(id)
    const type = await c.var.kanso.postTypes.get(post.postTypeId)
    return renderPost(c, post, type, { preview: true })
  })
