import type { Kanso } from '@kanso/core'
import type { StarterManifest } from '@kanso/shared'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import type { Principal } from '../middleware/auth.ts'
import { onError } from '../middleware/error.ts'
import { installStarter } from '../starter/install.ts'
import { setup } from './setup.ts'
import { starter } from './starter.ts'

vi.mock('../starter/install.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../starter/install.ts')>()),
  installStarter: vi.fn(),
}))

const installResult = {
  created: { pages: 4, posts: 3, postTypes: 1, categories: 2, tags: 0, forms: 1, media: 7 },
  skipped: [],
}

const manifest: StarterManifest = {
  installedAt: '2026-11-08T03:00:00.000Z',
  pages: [10, 11, 12, 13],
  posts: [20, 21, 22],
  postTypes: [30],
  categories: [40, 41],
  tags: [],
  forms: [50],
  media: [60, 61],
  themeSettings: null,
  siteDescription: null,
}

const adminUser = { id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin' as const }

function sessionFor(role: 'admin' | 'editor'): Principal {
  return { kind: 'session', token: 'test-token', user: { ...adminUser, role } } as Principal
}

function testApp(
  options: { role?: 'admin' | 'editor'; manifest?: StarterManifest | null; users?: number } = {},
) {
  const kanso: Kanso = Object.assign(Object.create(null), {
    settings: {
      starter: vi.fn().mockResolvedValue(options.manifest ?? null),
      site: vi.fn().mockResolvedValue({ title: 'kansoCMS', description: '', theme: 'default' }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    pages: {
      get: vi.fn((id: number) =>
        id === 12
          ? Promise.resolve({ id: 12, path: 'home' })
          : Promise.resolve({ id, path: `page-${id}` }),
      ),
    },
    auth: {
      countUsers: vi.fn().mockResolvedValue(options.users ?? 0),
      createUser: vi.fn().mockResolvedValue(adminUser),
      createSession: vi.fn().mockResolvedValue({ token: 'new-session' }),
    },
    cacheVersion: { bump: vi.fn().mockResolvedValue(undefined) },
    starter: {
      remove: vi.fn().mockResolvedValue({
        removed: { pages: 3, posts: 3, postTypes: 1, categories: 2, tags: 0, forms: 1, media: 5 },
        kept: [{ kind: 'page', id: 12, title: 'ホーム', reason: 'edited' }],
      }),
    },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      if (options.role) c.set('principal', sessionFor(options.role))
      await next()
    })
    .onError(onError)
    .route('/api/v1/starter', starter)
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

const setupInput = { email: 'admin@example.com', password: 'password123', name: 'Admin' }

beforeEach(() => {
  vi.mocked(installStarter).mockReset()
})

describe('starter API', () => {
  it('reports that nothing is installed', async () => {
    const { app, env } = testApp({ role: 'admin' })
    const response = await app.request('/api/v1/starter', {}, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ installed: false })
  })

  it('reports counts and the starter home page when installed', async () => {
    const { app, env } = testApp({ role: 'admin', manifest })
    const response = await app.request('/api/v1/starter', {}, env)
    expect(await response.json()).toEqual({
      installed: true,
      installedAt: manifest.installedAt,
      counts: { pages: 4, posts: 3, postTypes: 1, categories: 2, tags: 0, forms: 1, media: 2 },
      homePageId: 12,
    })
  })

  it('installs the starter site for an admin session', async () => {
    vi.mocked(installStarter).mockResolvedValue(installResult)
    const { app, env, kanso } = testApp({ role: 'admin' })
    const response = await app.request('/api/v1/starter', { method: 'POST' }, env)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(installResult)
    expect(installStarter).toHaveBeenCalledWith(kanso, {
      userId: 1,
      loadImage: expect.any(Function),
    })
  })

  it('maps a repeated install to 409', async () => {
    const { KansoError } = await import('@kanso/core')
    vi.mocked(installStarter).mockRejectedValue(
      KansoError.conflict('Starter content is already installed'),
    )
    const { app, env } = testApp({ role: 'admin', manifest })
    const response = await app.request('/api/v1/starter', { method: 'POST' }, env)
    expect(response.status).toBe(409)
  })

  it('removes the starter site and reports what was kept', async () => {
    const { app, env, kanso } = testApp({ role: 'admin', manifest })
    const response = await app.request('/api/v1/starter', { method: 'DELETE' }, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      removed: { pages: 3, posts: 3, postTypes: 1, categories: 2, tags: 0, forms: 1, media: 5 },
      kept: [{ kind: 'page', id: 12, title: 'ホーム', reason: 'edited' }],
    })
    expect(kanso.starter.remove).toHaveBeenCalled()
  })

  it('is limited to admins', async () => {
    const { app, env, kanso } = testApp({ role: 'editor' })
    expect((await app.request('/api/v1/starter', {}, env)).status).toBe(403)
    expect((await app.request('/api/v1/starter', { method: 'POST' }, env)).status).toBe(403)
    expect((await app.request('/api/v1/starter', { method: 'DELETE' }, env)).status).toBe(403)
    expect(installStarter).not.toHaveBeenCalled()
    expect(kanso.starter.remove).not.toHaveBeenCalled()
  })
})

describe('setup with the starter site', () => {
  it('installs the starter site when asked and bumps the cache generation', async () => {
    vi.mocked(installStarter).mockResolvedValue(installResult)
    const { app, env, kanso } = testApp()
    const response = await app.request(
      '/api/v1/setup',
      postJson({ ...setupInput, siteTitle: 'Example Shop', starter: true }),
      env,
    )
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
    const { app, env, kanso } = testApp()
    const response = await app.request(
      '/api/v1/setup',
      postJson({ ...setupInput, starter: true }),
      env,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('new-session')
    expect(await response.json()).toMatchObject({
      starter: { installed: false, error: 'Starter image hero.webp is missing' },
    })
    expect(kanso.auth.createSession).toHaveBeenCalled()
    error.mockRestore()
  })

  it('does not install the starter site unless asked', async () => {
    const { app, env } = testApp()
    const response = await app.request('/api/v1/setup', postJson(setupInput), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ starter: null })
    expect(installStarter).not.toHaveBeenCalled()
  })
})
