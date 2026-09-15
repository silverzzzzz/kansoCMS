import { type Kanso, KansoError } from '@kanso/core'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { bumpSiteCacheVersion, siteCache, siteCacheKey } from './cache.ts'
import { onError } from './error.ts'

function testExecutionContext() {
  const promises: Promise<unknown>[] = []
  return {
    executionCtx: {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        promises.push(promise)
      }),
      passThroughOnException: vi.fn(),
      props: {},
    },
    flush: async () => {
      await Promise.all(promises.splice(0))
    },
  }
}

function cacheTestSetup() {
  let version = 'abc'
  let renderCount = 0
  const get = vi.fn(() => Promise.resolve(version))
  const entries = new Map<string, Response>()
  const match = vi.fn((request: string) => Promise.resolve(entries.get(request)?.clone()))
  const put = vi.fn(async (request: string, response: Response) => {
    entries.set(request, response.clone())
  })
  vi.stubGlobal('caches', { default: { match, put } })

  const kanso: Kanso = Object.assign(Object.create(null), {
    cacheVersion: { get, bump: vi.fn() },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .use('*', siteCache)
    .get('/blog', (c) => {
      renderCount += 1
      return c.text(`render ${renderCount}`)
    })

  return {
    app,
    get,
    match,
    put,
    renderCount: () => renderCount,
    setVersion: (next: string) => {
      version = next
    },
  }
}

function bumpTestSetup() {
  const bump = vi.fn().mockResolvedValue('next-version')
  const kanso: Kanso = Object.assign(Object.create(null), {
    cacheVersion: { get: vi.fn(), bump },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .use('*', bumpSiteCacheVersion)
    .onError(onError)
    .post('/ok', (c) => c.json({ ok: true }, 201))
    .post('/invalid', (c) => c.json({ ok: false }, 400))
    .post('/error', () => {
      throw KansoError.notFound('Thing')
    })

  return { app, bump }
}

const env = Object.create(null) as Bindings

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('siteCacheKey', () => {
  it('keeps only the raw page value before the cache generation', () => {
    expect(siteCacheKey('https://example.com/blog?page=2&utm_source=x', 'abc')).toBe(
      'https://example.com/blog?page=2&__v=abc',
    )
    expect(siteCacheKey('https://example.com/blog?page=abc', 'abc')).toBe(
      'https://example.com/blog?page=abc&__v=abc',
    )
  })

  it('drops unrelated query parameters', () => {
    expect(siteCacheKey('https://example.com/blog?utm_source=x', 'abc')).toBe(
      'https://example.com/blog?__v=abc',
    )
  })
})

describe('siteCache', () => {
  it('misses, hits, and misses again after the generation changes', async () => {
    const setup = cacheTestSetup()
    const firstContext = testExecutionContext()
    const first = await setup.app.request(
      'https://example.com/blog?page=2&utm_source=x',
      undefined,
      env,
      firstContext.executionCtx,
    )

    expect(first.headers.get('x-kanso-cache')).toBe('MISS')
    expect(await first.text()).toBe('render 1')
    await firstContext.flush()
    expect(setup.put).toHaveBeenCalledWith(
      'https://example.com/blog?page=2&__v=abc',
      expect.any(Response),
    )

    const secondContext = testExecutionContext()
    const second = await setup.app.request(
      'https://example.com/blog?page=2',
      undefined,
      env,
      secondContext.executionCtx,
    )

    expect(second.headers.get('x-kanso-cache')).toBe('HIT')
    expect(await second.text()).toBe('render 1')
    expect(setup.renderCount()).toBe(1)

    setup.setVersion('def')
    const thirdContext = testExecutionContext()
    const third = await setup.app.request(
      'https://example.com/blog?page=2',
      undefined,
      env,
      thirdContext.executionCtx,
    )

    expect(third.headers.get('x-kanso-cache')).toBe('MISS')
    expect(await third.text()).toBe('render 2')
    expect(setup.renderCount()).toBe(2)
    await thirdContext.flush()
  })

  it('bypasses requests carrying the admin session cookie before cache access', async () => {
    const setup = cacheTestSetup()
    const context = testExecutionContext()
    const response = await setup.app.request(
      'https://example.com/blog',
      { headers: { Cookie: 'kanso_session=x' } },
      env,
      context.executionCtx,
    )

    expect(response.headers.get('x-kanso-cache')).toBeNull()
    expect(setup.get).not.toHaveBeenCalled()
    expect(setup.match).not.toHaveBeenCalled()
  })
})

describe('bumpSiteCacheVersion', () => {
  it('bumps once after a 2xx response', async () => {
    const { app, bump } = bumpTestSetup()
    const { executionCtx } = testExecutionContext()

    const response = await app.request('/ok', { method: 'POST' }, env, executionCtx)

    expect(response.status).toBe(201)
    expect(bump).toHaveBeenCalledOnce()
  })

  it('does not bump after a 4xx response', async () => {
    const { app, bump } = bumpTestSetup()
    const { executionCtx } = testExecutionContext()

    const response = await app.request('/invalid', { method: 'POST' }, env, executionCtx)

    expect(response.status).toBe(400)
    expect(bump).not.toHaveBeenCalled()
  })

  it('does not bump when a handler throws a KansoError', async () => {
    const { app, bump } = bumpTestSetup()
    const { executionCtx } = testExecutionContext()

    const response = await app.request('/error', { method: 'POST' }, env, executionCtx)

    expect(response.status).toBe(404)
    expect(bump).not.toHaveBeenCalled()
  })
})
