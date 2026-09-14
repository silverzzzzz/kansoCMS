import { zValidator } from '@hono/zod-validator'
import {
  createFormSchema,
  idSchema,
  submissionListQuerySchema,
  updateFormSchema,
} from '@kanso/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { turnstileConfig } from '../forms/turnstile.ts'
import { idParamSchema, validationHook } from './validate.ts'

const submissionParamSchema = z.object({ id: idSchema, submissionId: idSchema })
const markReadSchema = z.object({ read: z.boolean() })

async function formContext(c: Parameters<typeof turnstileConfig>[0]) {
  return { turnstileAvailable: (await turnstileConfig(c)) !== null }
}

export const forms = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ items: await c.var.kanso.forms.list() }))
  .post('/', zValidator('json', createFormSchema, validationHook), async (c) => {
    const item = await c.var.kanso.forms.create(c.req.valid('json'), await formContext(c))
    return c.json({ item }, 201)
  })
  .get(
    '/:id/submissions',
    zValidator('param', idParamSchema, validationHook),
    zValidator('query', submissionListQuerySchema, validationHook),
    async (c) => {
      const query = c.req.valid('query')
      const page = query.page ?? 1
      const perPage = query.perPage ?? 20
      const result = await c.var.kanso.forms.submissions.list({
        formId: c.req.valid('param').id,
        page,
        perPage,
        unread: query.unread === undefined ? undefined : query.unread === 'true',
      })
      return c.json({ ...result, page, perPage })
    },
  )
  .get(
    '/:id/submissions/:submissionId',
    zValidator('param', submissionParamSchema, validationHook),
    async (c) => {
      const { id, submissionId } = c.req.valid('param')
      return c.json({ item: await c.var.kanso.forms.submissions.get(id, submissionId) })
    },
  )
  .patch(
    '/:id/submissions/:submissionId',
    zValidator('param', submissionParamSchema, validationHook),
    zValidator('json', markReadSchema, validationHook),
    async (c) => {
      const { id, submissionId } = c.req.valid('param')
      const item = await c.var.kanso.forms.submissions.markRead(
        id,
        submissionId,
        c.req.valid('json').read,
      )
      return c.json({ item })
    },
  )
  .delete(
    '/:id/submissions/:submissionId',
    zValidator('param', submissionParamSchema, validationHook),
    async (c) => {
      const { id, submissionId } = c.req.valid('param')
      await c.var.kanso.forms.submissions.delete(id, submissionId)
      return c.json({ ok: true })
    },
  )
  .get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    return c.json({ item: await c.var.kanso.forms.get(c.req.valid('param').id) })
  })
  .patch(
    '/:id',
    zValidator('param', idParamSchema, validationHook),
    zValidator('json', updateFormSchema, validationHook),
    async (c) => {
      const item = await c.var.kanso.forms.update(
        c.req.valid('param').id,
        c.req.valid('json'),
        await formContext(c),
      )
      return c.json({ item })
    },
  )
  .delete('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
    await c.var.kanso.forms.delete(c.req.valid('param').id)
    return c.json({ ok: true })
  })
