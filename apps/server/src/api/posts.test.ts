import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { posts } from './posts.ts'

const post = {
  id: 4,
  postTypeId: 1,
  title: 'A post',
  slug: 'a-post',
  status: 'published' as const,
  publishedAt: new Date('2026-09-16T00:00:00.000Z'),
  deletedAt: new Date('2026-10-01T00:00:00.000Z'),
}

function testSetup() {
  const list = vi.fn().mockResolvedValue({ items: [post], total: 1 })
  const findBySlug = vi.fn().mockResolvedValue({ id: 1, slug: 'blog' })
  const deletePost = vi.fn().mockResolvedValue(undefined)
  const restore = vi.fn().mockResolvedValue({ ...post, deletedAt: null })
  const update = vi.fn().mockResolvedValue({ ...post, pinned: true })
  const kanso: Kanso = Object.assign(Object.create(null), {
    posts: { list, delete: deletePost, restore, update },
    postTypes: { findBySlug },
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
    .route('/api/v1/posts', posts)
  return { app, list, deletePost, restore, update }
}

describe('posts pinned API', () => {
  it('forwards pinned to the update service', async () => {
    const { app, update } = testSetup()
    const response = await app.request(
      '/api/v1/posts/4',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      },
      {} as Bindings,
    )

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ pinned: true }),
      expect.objectContaining({ userId: 7 }),
    )
  })

  it('forwards custom field values to the update service', async () => {
    const { app, update } = testSetup()
    const response = await app.request(
      '/api/v1/posts/4',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields: { venue: 'Hall A', capacity: 120 } }),
      },
      {} as Bindings,
    )

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ fields: { venue: 'Hall A', capacity: 120 } }),
      expect.objectContaining({ userId: 7 }),
    )
  })
})

describe('posts trash API', () => {
  it('passes trashed=true through to the list query', async () => {
    const { app, list } = testSetup()
    const response = await app.request('/api/v1/posts?trashed=true', undefined, {} as Bindings)

    expect(response.status).toBe(200)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ trashed: 'true' }))
  })

  it('soft deletes by default and purges with force=true', async () => {
    const { app, deletePost } = testSetup()
    const soft = await app.request('/api/v1/posts/4', { method: 'DELETE' }, {} as Bindings)
    const hard = await app.request(
      '/api/v1/posts/4?force=true',
      { method: 'DELETE' },
      {} as Bindings,
    )

    expect(soft.status).toBe(200)
    expect(hard.status).toBe(200)
    expect(deletePost).toHaveBeenNthCalledWith(1, 4, { force: false })
    expect(deletePost).toHaveBeenNthCalledWith(2, 4, { force: true })
  })

  it('rejects an invalid force value', async () => {
    const { app, deletePost } = testSetup()
    const response = await app.request(
      '/api/v1/posts/4?force=yes',
      { method: 'DELETE' },
      {} as Bindings,
    )

    expect(response.status).toBe(400)
    expect(deletePost).not.toHaveBeenCalled()
  })

  it('restores a trashed post', async () => {
    const { app, restore } = testSetup()
    const response = await app.request(
      '/api/v1/posts/4/restore',
      { method: 'POST' },
      {} as Bindings,
    )

    expect(response.status).toBe(200)
    expect(restore).toHaveBeenCalledWith(4)
  })
})

describe('posts duplicate & share links API', () => {
  function shareSetup() {
    const duplicate = vi.fn().mockResolvedValue({ ...post, id: 12, slug: 'a-post-copy' })
    const createLink = vi
      .fn()
      .mockResolvedValue({ id: 'b'.repeat(64), token: 'raw-token', expiresAt: new Date() })
    const get = vi.fn().mockResolvedValue(post)
    const kanso: Kanso = Object.assign(Object.create(null), {
      posts: { get, duplicate },
      shareLinks: { create: createLink },
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
      .route('/api/v1/posts', posts)
    return { app, duplicate, createLink }
  }

  it('duplicates a post with the session user as author', async () => {
    const { app, duplicate } = shareSetup()
    const response = await app.request(
      '/api/v1/posts/4/duplicate',
      { method: 'POST' },
      {} as Bindings,
    )

    expect(response.status).toBe(201)
    expect(duplicate).toHaveBeenCalledWith(4, { allowRawHtml: false, authorId: 7 })
  })

  it('issues a share link for a post', async () => {
    const { app, createLink } = shareSetup()
    const response = await app.request(
      '/api/v1/posts/4/share-links',
      { method: 'POST' },
      {} as Bindings,
    )

    expect(response.status).toBe(201)
    expect(createLink).toHaveBeenCalledWith({ targetType: 'post', targetId: 4, createdBy: 7 })
    await expect(response.json()).resolves.toMatchObject({
      item: { url: 'http://localhost/preview/share/raw-token' },
    })
  })
})
