import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { analytics } from './analytics.ts'

describe('analytics summary API', () => {
  function testSetup() {
    const summary = vi.fn().mockResolvedValue({
      daily: [{ day: '2026-11-10', count: 3 }],
      top: [{ path: '/', count: 3 }],
    })
    const site = vi.fn().mockResolvedValue({ timezone: 'Asia/Tokyo' })
    const kanso: Kanso = Object.assign(Object.create(null), {
      analytics: { summary },
      settings: { site },
    })
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('kanso', kanso)
        await next()
      })
      .onError(onError)
      .route('/api/v1/analytics', analytics)
    return { app, summary }
  }

  it('forwards days and the site timezone to the service', async () => {
    const { app, summary } = testSetup()
    const response = await app.request(
      '/api/v1/analytics/summary?days=7',
      undefined,
      {} as Bindings,
    )

    expect(response.status).toBe(200)
    expect(summary).toHaveBeenCalledWith(7, 'Asia/Tokyo')
    await expect(response.json()).resolves.toMatchObject({
      daily: [{ day: '2026-11-10', count: 3 }],
      top: [{ path: '/', count: 3 }],
    })
  })
})
