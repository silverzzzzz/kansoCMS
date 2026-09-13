import { createKanso } from '@kanso/core'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env.ts'

/** Builds the per-request core instance from bindings and exposes it as `c.var.kanso`. */
export const kansoMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('kanso', createKanso({ db: c.env.DB, media: c.env.MEDIA }))
  await next()
})
