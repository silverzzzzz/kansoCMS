import { Hono } from 'hono'
import type { AppEnv } from './env.ts'

/**
 * SPA fallback for the admin UI. Real files under /admin/* (JS, CSS, the
 * index itself) are served by Static Assets before the Worker runs; only
 * client-side routes like /admin/posts/12 reach here.
 */
export const admin = new Hono<AppEnv>().get('/*', async (c) => {
  const url = new URL(c.req.url)
  // A hashed asset that no longer exists (stale tab after a deploy) must not
  // come back as index.html, or the browser reports a MIME-type error instead.
  if (url.pathname.startsWith('/admin/assets/')) return c.notFound()
  url.pathname = '/admin/index.html'
  const res = await c.env.ASSETS.fetch(new Request(url, { method: 'GET' }))
  if (res.status === 404) {
    return c.text('Admin UI is not built. Run `pnpm --filter @kanso/admin build`.', 503)
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
})
