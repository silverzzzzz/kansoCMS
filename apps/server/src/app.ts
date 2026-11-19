import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { admin } from './admin.ts'
import { api } from './api/index.ts'
import type { AppEnv } from './env.ts'
import { media } from './media/index.ts'
import { onError } from './middleware/error.ts'
import { kansoMiddleware } from './middleware/kanso.ts'
import { site } from './site/routes.tsx'

/**
 * Route composition. Order matters: the public site is a catch-all and must
 * be mounted last. Static Assets (admin bundle, /themes/*.css, favicon) are
 * resolved by the platform before any of this runs.
 */
export const app = new Hono<AppEnv>()
  // secureHeaders overwrites after the handler, so Cross-Origin-Resource-Policy
  // is set below instead: `/media` answers `cross-origin`, the rest `same-origin`.
  .use(secureHeaders({ crossOriginResourcePolicy: false }))
  .use(async (c, next) => {
    await next()
    if (!c.res.headers.has('cross-origin-resource-policy')) {
      c.res.headers.set('cross-origin-resource-policy', 'same-origin')
    }
  })
  .use(kansoMiddleware)
  .onError(onError)
  .route('/api/v1', api)
  .route('/media', media)
  .route('/admin', admin)
  .route('/', site)

export type { ApiType } from './api/index.ts'
