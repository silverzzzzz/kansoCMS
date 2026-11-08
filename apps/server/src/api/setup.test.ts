import { type Kanso, KansoError } from '@kanso/core'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { installStarter } from '../starter/install.ts'
import { setup } from './setup.ts'

vi.mock('../starter/install.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../starter/install.ts')>()),
  installStarter: vi.fn(),
}))

const installResult = {
  created: { pages: 4, posts: 3, postTypes: 1, categories: 2, tags: 0, forms: 1, media: 7 },
  skipped: [],
}

const adminUser = { id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin' as const }
const options = { challenge: 'challenge', rp: { id: 'localhost', name: 'Example Shop' } }

const credential = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', attestationObject: 'oA' },
}

function testApp(setupInput: Record<string, unknown> = {}) {
  const kanso: Kanso = Object.assign(Object.create(null), {
    settings: {
      site: vi.fn().mockResolvedValue({ title: 'kansoCMS', description: '', theme: 'default' }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    auth: {
      countUsers: vi.fn().mockResolvedValue(0),
      createSession: vi.fn().mockResolvedValue({ token: 'new-session' }),
    },
    passkeys: {
      setupOptions: vi.fn().mockResolvedValue(options),
      finishSetup: vi.fn().mockResolvedValue({
        user: adminUser,
        setup: { email: 'admin@example.com', name: 'Admin', ...setupInput },
      }),
    },
    cacheVersion: { bump: vi.fn().mockResolvedValue(undefined) },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .onError(onError)
    .route('/api/v1/setup', setup)
  const assets = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
  const env = { ASSETS: { fetch: assets } } as unknown as Bindings
  return { app, env, kanso }
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

beforeEach(() => {
  vi.mocked(installStarter).mockReset()
})

describe('setup options', () => {
  it('returns passkey creation options for the first admin', async () => {
    const { app, env, kanso } = testApp()
    const input = { email: 'admin@example.com', name: 'Admin', siteTitle: 'Example Shop' }
    const response = await app.request('/api/v1/setup/options', postJson(input), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ options })
    expect(kanso.passkeys.setupOptions).toHaveBeenCalledWith(input, {
      id: 'localhost',
      origin: 'http://localhost',
      name: 'Example Shop',
    })
  })

  it('names the relying party after the current site when no title is given', async () => {
    const { app, env, kanso } = testApp()
    await app.request(
      '/api/v1/setup/options',
      postJson({ email: 'admin@example.com', name: 'Admin' }),
      env,
    )
    expect(kanso.passkeys.setupOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'kansoCMS' }),
    )
  })

  it('no longer accepts a password', async () => {
    const { app, env, kanso } = testApp()
    const response = await app.request(
      '/api/v1/setup/options',
      postJson({ email: 'not-an-email', name: 'Admin', password: 'password123' }),
      env,
    )
    expect(response.status).toBe(400)
    expect(kanso.passkeys.setupOptions).not.toHaveBeenCalled()
  })

  it('maps a completed setup to 409', async () => {
    const { app, env, kanso } = testApp()
    vi.mocked(kanso.passkeys.setupOptions).mockRejectedValue(
      KansoError.conflict('Setup has already been completed'),
    )
    const response = await app.request(
      '/api/v1/setup/options',
      postJson({ email: 'admin@example.com', name: 'Admin' }),
      env,
    )
    expect(response.status).toBe(409)
  })
})

describe('finishing setup', () => {
  it('creates the admin with the passkey and signs them in', async () => {
    const { app, env, kanso } = testApp()
    const response = await app.request(
      '/api/v1/setup',
      postJson({ credential, passkeyName: 'Windows' }),
      env,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('new-session')
    expect(await response.json()).toEqual({ user: adminUser, starter: null })
    expect(kanso.passkeys.finishSetup).toHaveBeenCalledWith(
      credential,
      { id: 'localhost', origin: 'http://localhost', name: 'kansoCMS' },
      'Windows',
    )
    expect(installStarter).not.toHaveBeenCalled()
  })

  it('installs the starter site when asked and bumps the cache generation', async () => {
    vi.mocked(installStarter).mockResolvedValue(installResult)
    const { app, env, kanso } = testApp({ siteTitle: 'Example Shop', starter: true })
    const response = await app.request('/api/v1/setup', postJson({ credential }), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      user: { id: 1 },
      starter: { installed: true, error: null },
    })
    expect(installStarter).toHaveBeenCalledWith(kanso, {
      userId: 1,
      loadImage: expect.any(Function),
    })
    // The site title is saved before the starter content reads it.
    expect(vi.mocked(kanso.settings.set).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(installStarter).mock.invocationCallOrder[0] ?? 0,
    )
    expect(kanso.cacheVersion.bump).toHaveBeenCalled()
  })

  it('completes setup even when the starter install fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(installStarter).mockRejectedValue(new Error('Starter image hero.webp is missing'))
    const { app, env, kanso } = testApp({ starter: true })
    const response = await app.request('/api/v1/setup', postJson({ credential }), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('new-session')
    expect(await response.json()).toMatchObject({
      starter: { installed: false, error: 'Starter image hero.webp is missing' },
    })
    expect(kanso.auth.createSession).toHaveBeenCalled()
    error.mockRestore()
  })

  it('does not sign anyone in when the passkey is rejected', async () => {
    const { app, env, kanso } = testApp()
    vi.mocked(kanso.passkeys.finishSetup).mockRejectedValue(
      KansoError.unauthorized('Passkey verification failed: origin mismatch'),
    )
    const response = await app.request('/api/v1/setup', postJson({ credential }), env)
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(kanso.cacheVersion.bump).not.toHaveBeenCalled()
  })

  it('rejects a body without a credential', async () => {
    const { app, env } = testApp()
    const response = await app.request(
      '/api/v1/setup',
      postJson({ email: 'admin@example.com', password: 'password123', name: 'Admin' }),
      env,
    )
    expect(response.status).toBe(400)
  })
})
