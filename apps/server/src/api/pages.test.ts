import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { pages } from './pages.ts'

const page = {
  id: 4,
  title: 'Current title',
  slug: 'current',
  path: 'current',
  parentId: null,
  sortOrder: 0,
  bodyJson: { type: 'doc' as const, content: [] },
  bodyHtml: '',
  excerpt: null,
  status: 'draft' as const,
  publishedAt: null,
  seoTitle: null,
  seoDescription: null,
  ogMediaId: null,
  noindex: false,
  canonicalUrl: null,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
  updatedAt: new Date('2026-09-16T00:00:00.000Z'),
}

function testSetup() {
  const get = vi.fn().mockResolvedValue(page)
  const list = vi.fn().mockResolvedValue([
    {
      id: 9,
      createdAt: new Date('2026-09-16T01:00:00.000Z'),
      user: { id: 7, name: 'Editor' },
      title: 'Before update',
      status: 'draft',
    },
  ])
  const restoreRevision = vi.fn().mockResolvedValue({ ...page, title: 'Before update' })
  const kanso: Kanso = Object.assign(Object.create(null), {
    pages: { get, restoreRevision },
    revisions: { list },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      c.set('principal', {
        kind: 'session',
        token: 'test-token',
        user: { id: 7, email: 'editor@example.com', name: 'Editor', role: 'editor' },
      })
      await next()
    })
    .onError(onError)
    .route('/api/v1/pages', pages)
  return { app, get, list, restoreRevision }
}

describe('pages revision API', () => {
  it('returns revision summaries after checking the page exists', async () => {
    const { app, get, list } = testSetup()
    const response = await app.request('/api/v1/pages/4/revisions', undefined, {} as Bindings)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: 9,
          createdAt: '2026-09-16T01:00:00.000Z',
          user: { id: 7, name: 'Editor' },
          title: 'Before update',
          status: 'draft',
        },
      ],
    })
    expect(get).toHaveBeenCalledWith(4)
    expect(list).toHaveBeenCalledWith('page', 4)
  })

  it('forwards the session user id when restoring', async () => {
    const { app, restoreRevision } = testSetup()
    const response = await app.request(
      '/api/v1/pages/4/revisions/9/restore',
      { method: 'POST' },
      {} as Bindings,
    )

    expect(response.status).toBe(200)
    expect(restoreRevision).toHaveBeenCalledWith(4, 9, {
      allowRawHtml: false,
      userId: 7,
    })
  })
})
