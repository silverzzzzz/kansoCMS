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
        user: {
          id: 7,
          email: 'editor@example.com',
          name: 'Editor',
          slug: 'editor',
          role: 'editor',
        },
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

describe('pages trash API', () => {
  function trashSetup() {
    const list = vi.fn().mockResolvedValue({ items: [page], total: 1 })
    const deletePage = vi.fn().mockResolvedValue(undefined)
    const restore = vi.fn().mockResolvedValue({ ...page, deletedAt: null })
    const kanso: Kanso = Object.assign(Object.create(null), {
      pages: { list, delete: deletePage, restore },
    })
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('kanso', kanso)
        c.set('principal', {
          kind: 'session',
          token: 'test-token',
          user: {
            id: 7,
            email: 'editor@example.com',
            name: 'Editor',
            slug: 'editor',
            role: 'editor',
          },
        })
        await next()
      })
      .onError(onError)
      .route('/api/v1/pages', pages)
    return { app, list, deletePage, restore }
  }

  it('passes trashed=true through to the list query', async () => {
    const { app, list } = trashSetup()
    const response = await app.request('/api/v1/pages?trashed=true', undefined, {} as Bindings)

    expect(response.status).toBe(200)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ trashed: 'true' }))
  })

  it('soft deletes by default and purges with force=true', async () => {
    const { app, deletePage } = trashSetup()
    const soft = await app.request('/api/v1/pages/4', { method: 'DELETE' }, {} as Bindings)
    const hard = await app.request(
      '/api/v1/pages/4?force=true',
      { method: 'DELETE' },
      {} as Bindings,
    )

    expect(soft.status).toBe(200)
    expect(hard.status).toBe(200)
    expect(deletePage).toHaveBeenNthCalledWith(1, 4, { force: false })
    expect(deletePage).toHaveBeenNthCalledWith(2, 4, { force: true })
  })

  it('rejects an invalid force value', async () => {
    const { app, deletePage } = trashSetup()
    const response = await app.request(
      '/api/v1/pages/4?force=yes',
      { method: 'DELETE' },
      {} as Bindings,
    )

    expect(response.status).toBe(400)
    expect(deletePage).not.toHaveBeenCalled()
  })

  it('restores a trashed page', async () => {
    const { app, restore } = trashSetup()
    const response = await app.request(
      '/api/v1/pages/4/restore',
      { method: 'POST' },
      {} as Bindings,
    )

    expect(response.status).toBe(200)
    expect(restore).toHaveBeenCalledWith(4)
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
          user: {
            id: 7,
            email: 'editor@example.com',
            name: 'Editor',
            slug: 'editor',
            role: 'editor',
          },
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

describe('pages duplicate & share links API', () => {
  function shareSetup() {
    const duplicate = vi.fn().mockResolvedValue({ ...page, id: 12, slug: 'current-copy' })
    const listFor = vi
      .fn()
      .mockResolvedValue([{ id: 'a'.repeat(64), expiresAt: new Date('2026-09-23T00:00:00Z') }])
    const createLink = vi
      .fn()
      .mockResolvedValue({ id: 'b'.repeat(64), token: 'raw-token', expiresAt: new Date() })
    const get = vi.fn().mockResolvedValue(page)
    const kanso: Kanso = Object.assign(Object.create(null), {
      pages: { get, duplicate },
      shareLinks: { listFor, create: createLink },
    })
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('kanso', kanso)
        c.set('principal', {
          kind: 'session',
          token: 'test-token',
          user: {
            id: 7,
            email: 'editor@example.com',
            name: 'Editor',
            slug: 'editor',
            role: 'editor',
          },
        })
        await next()
      })
      .onError(onError)
      .route('/api/v1/pages', pages)
    return { app, duplicate, listFor, createLink, get }
  }

  it('duplicates a page with the caller raw-html permission', async () => {
    const { app, duplicate } = shareSetup()
    const response = await app.request(
      '/api/v1/pages/4/duplicate',
      { method: 'POST' },
      {} as Bindings,
    )

    expect(response.status).toBe(201)
    expect(duplicate).toHaveBeenCalledWith(4, { allowRawHtml: false })
    await expect(response.json()).resolves.toMatchObject({
      item: { id: 12, slug: 'current-copy' },
    })
  })

  it('issues a share link URL against the request origin', async () => {
    const { app, createLink } = shareSetup()
    const response = await app.request(
      '/api/v1/pages/4/share-links',
      { method: 'POST' },
      {} as Bindings,
    )

    expect(response.status).toBe(201)
    expect(createLink).toHaveBeenCalledWith({ targetType: 'page', targetId: 4, createdBy: 7 })
    await expect(response.json()).resolves.toMatchObject({
      item: { url: 'http://localhost/preview/share/raw-token' },
    })
  })

  it('lists existing share links for a page', async () => {
    const { app, listFor, get } = shareSetup()
    const response = await app.request('/api/v1/pages/4/share-links', undefined, {} as Bindings)

    expect(response.status).toBe(200)
    expect(get).toHaveBeenCalledWith(4)
    expect(listFor).toHaveBeenCalledWith('page', 4)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'a'.repeat(64) }],
    })
  })
})
