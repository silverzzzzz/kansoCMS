import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { settings } from './settings.ts'

function testApp() {
  const updateTheme = vi.fn().mockImplementation((value: unknown) => Promise.resolve(value))
  const kanso: Kanso = Object.assign(Object.create(null), {
    settings: { theme: vi.fn().mockResolvedValue({}), updateTheme },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      c.set('principal', {
        kind: 'session',
        token: 'test-token',
        user: { id: 1, email: 'admin@example.com', name: 'Admin', slug: 'admin', role: 'admin' },
      })
      await next()
    })
    .onError(onError)
    .route('/api/v1/settings', settings)
  return { app, updateTheme }
}

function put(app: Hono<AppEnv>, body: unknown) {
  return app.request(
    '/api/v1/settings/theme',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    {} as Bindings,
  )
}

describe('theme settings API', () => {
  it('saves settings valid for each theme namespace', async () => {
    const { app, updateTheme } = testApp()
    const body = {
      default: { accent: '#ff0000', footer_text: 'Hi' },
      paper: { sns_url_1: 'https://example.com/a' },
    }
    const response = await put(app, body)
    expect(response.status).toBe(200)
    expect(updateTheme).toHaveBeenCalledWith(body)
  })

  it('rejects unknown theme names and invalid field values', async () => {
    const { app, updateTheme } = testApp()
    const response = await put(app, {
      nope: { accent: '#ff0000' },
      default: { accent: 'red', sns_url_1: 'not a url' },
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as {
      error: { details: { path: string; message: string }[] }
    }
    const paths = body.error.details.map((detail) => detail.path)
    expect(paths).toContain('nope')
    expect(paths.some((path) => path.startsWith('default.accent'))).toBe(true)
    expect(paths.some((path) => path.startsWith('default.sns_url_1'))).toBe(true)
    expect(updateTheme).not.toHaveBeenCalled()
  })
})
