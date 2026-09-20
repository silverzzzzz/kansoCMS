import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { redirects } from './redirects.ts'

const redirect = {
  id: 1,
  fromPath: 'old',
  to: '/new',
  status: 301 as const,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
  updatedAt: new Date('2026-09-16T00:00:00.000Z'),
}

function testSetup() {
  const create = vi.fn().mockResolvedValue(redirect)
  const kanso: Kanso = Object.assign(Object.create(null), {
    redirects: { create },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .onError(onError)
    .route('/api/v1/redirects', redirects)
  return { app, create }
}

describe('redirects API', () => {
  it('normalizes the source path before creating a redirect', async () => {
    const { app, create } = testSetup()
    const response = await app.request(
      '/api/v1/redirects',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromPath: '/old/', to: '/new', status: 301 }),
      },
      {} as Bindings,
    )

    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledWith({ fromPath: 'old', to: '/new', status: 301 })
  })

  it('returns the standard validation error shape for an invalid redirect', async () => {
    const { app, create } = testSetup()
    const response = await app.request(
      '/api/v1/redirects',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromPath: 'old', to: '/old/' }),
      },
      {} as Bindings,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'validation',
        message: 'Invalid request',
        details: [{ path: 'to', message: 'Redirect target equals its source' }],
      },
    })
    expect(create).not.toHaveBeenCalled()
  })
})
