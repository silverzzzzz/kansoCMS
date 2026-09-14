import { KansoError } from '@kanso/core'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from '../env.ts'
import { parseBody } from '../forms/body.ts'
import { submitForm } from '../forms/submit.ts'

export const publicForms = new Hono<AppEnv>()
  .use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  )
  .post('/:slug/submissions', async (c) => {
    const form = await c.var.kanso.forms.findBySlug(c.req.param('slug'))
    if (!form) throw KansoError.notFound('Form')

    const result = await submitForm(c, form, await parseBody(c.req.raw))
    return c.json({ ok: true, message: result.message, redirectUrl: result.redirectUrl }, 201)
  })
