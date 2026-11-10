import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { shareLinks } from './share-links.ts'

function testSetup() {
  const revoke = vi.fn().mockResolvedValue(undefined)
  const kanso: Kanso = Object.assign(Object.create(null), {
    shareLinks: { revoke },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .onError(onError)
    .route('/api/v1/share-links', shareLinks)
  return { app, revoke }
}

describe('share-links API', () => {
  it('revokes a link by its hash id', async () => {
    const { app, revoke } = testSetup()
    const id = 'a'.repeat(64)
    const response = await app.request(
      `/api/v1/share-links/${id}`,
      { method: 'DELETE' },
      {} as Bindings,
    )

    expect(response.status).toBe(200)
    expect(revoke).toHaveBeenCalledWith(id)
  })

  it('rejects a malformed link id', async () => {
    const { app, revoke } = testSetup()
    const response = await app.request(
      '/api/v1/share-links/not-a-hash',
      { method: 'DELETE' },
      {} as Bindings,
    )

    expect(response.status).toBe(400)
    expect(revoke).not.toHaveBeenCalled()
  })
})
