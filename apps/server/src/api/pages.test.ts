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

describe('pages sections input', () => {
  function sectionsSetup() {
    const create = vi
      .fn()
      .mockImplementation((input: { sections?: unknown }) =>
        Promise.resolve({ ...page, id: 8, sectionsJson: input.sections ?? null }),
      )
    const update = vi.fn().mockResolvedValue({ ...page, sectionsJson: null })
    const kanso: Kanso = Object.assign(Object.create(null), {
      pages: { create, update },
      settings: { site: vi.fn().mockResolvedValue({ theme: 'default' }) },
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
    return { app, create, update }
  }

  function post(app: Hono<AppEnv>, body: unknown) {
    return app.request(
      '/api/v1/pages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      {} as Bindings,
    )
  }

  it('saves sections valid for the active theme and exposes them as `sections`', async () => {
    const { app, create } = sectionsSetup()
    const sections = [{ id: 'hero1', type: 'hero', settings: { heading: 'Hi' } }]
    const response = await post(app, { title: 'Landing', slug: 'landing', sections })

    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sections }), expect.anything())
    const body = (await response.json()) as { item: Record<string, unknown> }
    expect(body.item.sections).toEqual(sections)
    expect('sectionsJson' in body.item).toBe(false)
  })

  it('rejects unknown section types and invalid settings with field paths', async () => {
    const { app, create } = sectionsSetup()
    const response = await post(app, {
      title: 'Landing',
      slug: 'landing',
      sections: [
        { id: 'a', type: 'no_such_type', settings: {} },
        { id: 'b', type: 'hero', settings: { heading: 42 } },
      ],
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as {
      error: { details: { path: string; message: string }[] }
    }
    const paths = body.error.details.map((detail) => detail.path)
    expect(paths).toContain('sections.0.type')
    expect(paths.some((path) => path.startsWith('sections.1.settings.heading'))).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
})
