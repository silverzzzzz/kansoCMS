import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { search } from './search.ts'

function testSetup() {
  const searchQuery = vi.fn().mockResolvedValue({ items: [], total: 0, page: 2, perPage: 10 })
  const reindex = vi.fn().mockResolvedValue({ pages: 3, posts: 4 })
  const kanso: Kanso = Object.assign(Object.create(null), {
    search: { search: searchQuery, reindex },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .onError(onError)
    .route('/api/v1/search', search)
  return { app, searchQuery, reindex }
}

describe('search API', () => {
  it('returns the standard 400 validation shape without q', async () => {
    const { app, searchQuery } = testSetup()
    const response = await app.request('/api/v1/search', undefined, {} as Bindings)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'validation',
        message: 'Invalid request',
        details: [{ path: 'q', message: expect.any(String) }],
      },
    })
    expect(searchQuery).not.toHaveBeenCalled()
  })

  it('passes the parsed query and returns the search result', async () => {
    const { app, searchQuery } = testSetup()
    const response = await app.request('/api/v1/search?q=hello&page=2', undefined, {} as Bindings)
    expect(response.status).toBe(200)
    expect(searchQuery).toHaveBeenCalledWith({ q: 'hello', page: 2, perPage: 10 })
    await expect(response.json()).resolves.toEqual({ items: [], total: 0, page: 2, perPage: 10 })
  })

  it('reindexes pages and posts', async () => {
    const { app, reindex } = testSetup()
    const response = await app.request('/api/v1/search/reindex', { method: 'POST' }, {} as Bindings)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, pages: 3, posts: 4 })
    expect(reindex).toHaveBeenCalledOnce()
  })
})
