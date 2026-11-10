import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import type { Principal } from '../middleware/auth.ts'
import { requireAuth } from '../middleware/auth.ts'
import { onError } from '../middleware/error.ts'
import { activity, logActivity } from './activity.ts'
import { posts } from './posts.ts'

const session: Principal = {
  kind: 'session',
  token: 'token',
  user: { id: 7, email: 'editor@example.com', name: 'Editor', slug: 'editor', role: 'admin' },
}
const readKey: Principal = {
  kind: 'apiKey',
  apiKey: { id: 1, name: 'CI', scope: 'read' },
}

const rows = [
  {
    id: 2,
    actor: 'Editor',
    userId: 7,
    action: 'update',
    targetType: 'post',
    targetId: '5',
    summary: '投稿「Hi」を更新',
    createdAt: new Date('2026-12-01T00:00:00Z'),
  },
]

function testApp(principal?: Principal, kansoOverrides: Partial<Kanso> = {}) {
  const listFn = vi.fn().mockResolvedValue(rows)
  const logFn = vi.fn().mockResolvedValue(undefined)
  const kanso: Kanso = Object.assign(Object.create(null), {
    activity: { list: listFn, log: logFn },
    ...kansoOverrides,
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      if (principal) c.set('principal', principal)
      await next()
    })
    .onError(onError)
    .route(
      '/api/v1',
      new Hono<AppEnv>()
        .use('*', requireAuth('read'))
        .on(['POST', 'PATCH', 'DELETE'], '*', requireAuth('write'))
        .route('/activity', activity),
    )
  return { app, listFn, logFn }
}

describe('activity API', () => {
  it('requires authentication', async () => {
    const { app } = testApp()
    expect((await app.request('/api/v1/activity')).status).toBe(401)
  })

  it('lists the newest entries for a read-scope principal', async () => {
    const { app, listFn } = testApp(readKey)
    const response = await app.request('/api/v1/activity', undefined, {} as Bindings)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: typeof rows }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.actor).toBe('Editor')
    expect(listFn).toHaveBeenCalledWith(100)
  })

  it('forwards ?limit to the service', async () => {
    const { app, listFn } = testApp(session)
    await app.request('/api/v1/activity?limit=50', undefined, {} as Bindings)
    expect(listFn).toHaveBeenCalledWith(50)
  })

  it('rejects a limit above the cap', async () => {
    const { app, listFn } = testApp(session)
    expect((await app.request('/api/v1/activity?limit=999')).status).toBe(400)
    expect(listFn).not.toHaveBeenCalled()
  })
})

describe('logActivity', () => {
  function recorderApp(
    principal: Principal | undefined,
    logFn = vi.fn().mockResolvedValue(undefined),
  ) {
    const kanso: Kanso = Object.assign(Object.create(null), {
      activity: { log: logFn },
    })
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('kanso', kanso)
        if (principal) c.set('principal', principal)
        await next()
      })
      .post('/go', async (c) => {
        await logActivity(c, { action: 'update', targetType: 'post', targetId: 5, summary: 'x' })
        return c.json({ ok: true })
      })
    return { app, logFn }
  }

  it('uses the session user as the actor', async () => {
    const { app, logFn } = recorderApp(session)
    await app.request('/go', { method: 'POST' })
    expect(logFn).toHaveBeenCalledWith({
      actor: 'Editor',
      userId: 7,
      action: 'update',
      targetType: 'post',
      targetId: 5,
      summary: 'x',
    })
  })

  it('names API keys as actors', async () => {
    const { app, logFn } = recorderApp(readKey)
    await app.request('/go', { method: 'POST' })
    expect(logFn).toHaveBeenCalledWith(expect.objectContaining({ actor: 'api-key:CI' }))
  })

  it('falls back to system without a principal', async () => {
    const { app, logFn } = recorderApp(undefined)
    await app.request('/go', { method: 'POST' })
    expect(logFn).toHaveBeenCalledWith(expect.objectContaining({ actor: 'system' }))
  })

  it('never breaks the request when logging fails', async () => {
    const { app } = recorderApp(session, vi.fn().mockRejectedValue(new Error('db down')))
    const response = await app.request('/go', { method: 'POST' })
    expect(response.status).toBe(200)
  })
})

describe('mutation instrumentation', () => {
  it('records a post create through the real route', async () => {
    const logFn = vi.fn().mockResolvedValue(undefined)
    const createFn = vi.fn().mockResolvedValue({ id: 5, title: 'Hi' })
    const kanso: Kanso = Object.assign(Object.create(null), {
      activity: { log: logFn },
      posts: { create: createFn },
    })
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('kanso', kanso)
        c.set('principal', session)
        await next()
      })
      .onError(onError)
      .route(
        '/api/v1',
        new Hono<AppEnv>()
          .use('*', requireAuth('read'))
          .on(['POST'], '*', requireAuth('write'))
          .route('/posts', posts),
      )

    const response = await app.request('/api/v1/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postTypeId: 1, slug: 'hi', title: 'Hi' }),
    })

    expect(response.status).toBe(201)
    expect(logFn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        targetType: 'post',
        targetId: 5,
        summary: '投稿「Hi」を作成',
        actor: 'Editor',
        userId: 7,
      }),
    )
  })
})
