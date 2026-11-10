import type { Kanso } from '@kanso/core'
import { exportBundleSchema } from '@kanso/shared'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import type { Principal } from '../middleware/auth.ts'
import { requireAuth } from '../middleware/auth.ts'
import { onError } from '../middleware/error.ts'
import { transfer } from './transfer.ts'

const session: Principal = {
  kind: 'session',
  token: 'token',
  user: { id: 7, email: 'editor@example.com', name: 'Editor', slug: 'editor', role: 'admin' },
}
const readKey: Principal = {
  kind: 'apiKey',
  apiKey: { id: 1, name: 'CI', scope: 'read' },
}
const writeKey: Principal = {
  kind: 'apiKey',
  apiKey: { id: 2, name: 'CI', scope: 'write' },
}

const bundle = {
  version: 1,
  exportedAt: '2026-12-01T00:00:00.000Z',
  postTypes: [],
  categories: [],
  tags: [],
  media: [],
  pages: [],
  posts: [
    {
      postType: 'blog',
      slug: 'hello',
      title: 'Hello',
      pinned: false,
      categories: [],
      tags: [],
      status: 'published',
      publishedAt: '2026-11-01T00:00:00.000Z',
      noindex: false,
    },
  ],
  redirects: [],
  menus: [],
}

function testApp(principal?: Principal) {
  const exportFn = vi.fn().mockResolvedValue(bundle)
  const importFn = vi
    .fn()
    .mockResolvedValue({ created: 1, updated: 0, skipped: 2, warnings: ['w'] })
  const kanso: Kanso = Object.assign(Object.create(null), {
    transfer: { export: exportFn, import: importFn },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      if (principal) c.set('principal', principal)
      await next()
    })
    .onError(onError)
    .route('/api/v1', new Hono<AppEnv>().use('*', requireAuth('read')).route('/', transfer))
  return { app, exportFn, importFn }
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('export API', () => {
  it('returns the bundle as an attachment without settings by default', async () => {
    const { app, exportFn } = testApp(session)
    const response = await app.request('/api/v1/export', undefined, {} as Bindings)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('kanso-export-2026-12-01.json')
    expect(await response.json()).toEqual(bundle)
    expect(exportFn).toHaveBeenCalledWith({ settings: false })
  })

  it('passes ?settings=1 through to the service', async () => {
    const { app, exportFn } = testApp(session)
    const response = await app.request('/api/v1/export?settings=1', undefined, {} as Bindings)
    expect(response.status).toBe(200)
    expect(exportFn).toHaveBeenCalledWith({ settings: true })
  })

  it('requires the write scope even though it is a GET', async () => {
    expect((await testApp().app.request('/api/v1/export')).status).toBe(401)
    const { app, exportFn } = testApp(readKey)
    expect((await app.request('/api/v1/export')).status).toBe(403)
    expect(exportFn).not.toHaveBeenCalled()
  })
})

describe('import API', () => {
  it('validates the bundle and returns the report', async () => {
    const { app, importFn } = testApp(writeKey)
    const response = await app.request('/api/v1/import', json(bundle))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      created: 1,
      updated: 0,
      skipped: 2,
      warnings: ['w'],
    })
    expect(importFn).toHaveBeenCalledWith(exportBundleSchema.parse(bundle), {
      allowRawHtml: false,
      userId: null,
    })
  })

  it('rejects a bundle with a wrong version', async () => {
    const { app, importFn } = testApp(writeKey)
    const response = await app.request('/api/v1/import', json({ ...bundle, version: 2 }))
    expect(response.status).toBe(400)
    expect(importFn).not.toHaveBeenCalled()
  })

  it('passes the session user for revision attribution and raw HTML', async () => {
    const { app, importFn } = testApp(session)
    await app.request('/api/v1/import', json(bundle))
    expect(importFn).toHaveBeenCalledWith(exportBundleSchema.parse(bundle), {
      allowRawHtml: true,
      userId: 7,
    })
  })
})
