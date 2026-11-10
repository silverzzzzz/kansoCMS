import { type Kanso, KansoError } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.ts'
import type { Principal } from '../middleware/auth.ts'
import { onError } from '../middleware/error.ts'
import { auth } from './auth.ts'

const user = {
  id: 7,
  email: 'editor@example.com',
  name: 'Editor',
  slug: 'editor',
  role: 'editor' as const,
}
const rp = { id: 'localhost', origin: 'http://localhost', name: 'kansoCMS' }
const passkey = {
  id: 3,
  name: 'Windows',
  backedUp: false,
  createdAt: '2026-11-08T00:00:00.000Z',
  lastUsedAt: null,
}

const registration = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', attestationObject: 'oA' },
}
const assertion = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA', userHandle: null },
}

function testApp(principal?: Principal) {
  const kanso: Kanso = Object.assign(Object.create(null), {
    settings: {
      site: vi.fn().mockResolvedValue({ title: 'kansoCMS', description: '', theme: 'default' }),
    },
    auth: {
      createSession: vi.fn().mockResolvedValue({ token: 'new-session' }),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getProfile: vi.fn().mockResolvedValue({ slug: 'editor', bio: 'Hello', avatarMediaId: null }),
      updateProfile: vi.fn().mockImplementation((_id: number, input: unknown) => {
        const profile = { slug: 'editor', bio: 'Hello', avatarMediaId: null }
        return Promise.resolve({ ...profile, ...(input as object) })
      }),
    },
    passkeys: {
      loginOptions: vi.fn().mockResolvedValue({ challenge: 'login' }),
      finishLogin: vi.fn().mockResolvedValue(user),
      list: vi.fn().mockResolvedValue([passkey]),
      registerOptions: vi.fn().mockResolvedValue({ challenge: 'register' }),
      finishRegister: vi.fn().mockResolvedValue(passkey),
      rename: vi.fn().mockResolvedValue({ ...passkey, name: 'Phone' }),
      remove: vi.fn().mockResolvedValue(undefined),
      linkOptions: vi.fn().mockResolvedValue({
        options: { challenge: 'link' },
        user: { email: user.email, name: user.name },
      }),
      finishLink: vi.fn().mockResolvedValue(user),
    },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      if (principal) c.set('principal', principal)
      await next()
    })
    .onError(onError)
    .route('/api/v1/auth', auth)
  return { app, kanso }
}

const session: Principal = { kind: 'session', token: 'token', user }
const apiKey: Principal = { kind: 'apiKey', apiKey: { id: 1, name: 'CI', scope: 'write' } }

function json(method: string, body?: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

describe('passkey sign-in', () => {
  it('issues sign-in options for the request host', async () => {
    const { app, kanso } = testApp()
    const response = await app.request('/api/v1/auth/passkey/options', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ options: { challenge: 'login' } })
    expect(kanso.passkeys.loginOptions).toHaveBeenCalledWith(rp)
  })

  it('starts a session for a verified passkey', async () => {
    const { app, kanso } = testApp()
    const response = await app.request(
      '/api/v1/auth/passkey',
      json('POST', { credential: assertion }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('kanso_session=new-session')
    expect(await response.json()).toEqual({ user })
    expect(kanso.passkeys.finishLogin).toHaveBeenCalledWith(assertion, rp)
    expect(kanso.auth.createSession).toHaveBeenCalledWith(7)
  })

  it('answers 401 without a session when verification fails', async () => {
    const { app, kanso } = testApp()
    vi.mocked(kanso.passkeys.finishLogin).mockRejectedValue(
      KansoError.unauthorized('This passkey is not registered'),
    )
    const response = await app.request(
      '/api/v1/auth/passkey',
      json('POST', { credential: assertion }),
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('rejects malformed credentials before verification', async () => {
    const { app, kanso } = testApp()
    const response = await app.request(
      '/api/v1/auth/passkey',
      json('POST', { credential: { ...assertion, rawId: 'not base64url!' } }),
    )
    expect(response.status).toBe(400)
    expect(kanso.passkeys.finishLogin).not.toHaveBeenCalled()
  })

  it('has no password sign-in', async () => {
    const { app } = testApp()
    const response = await app.request(
      '/api/v1/auth/login',
      json('POST', { email: 'admin@example.com', password: 'password123' }),
    )
    expect(response.status).toBe(404)
  })
})

describe('own passkeys', () => {
  it('lists, adds, renames and removes the signed-in user’s passkeys', async () => {
    const { app, kanso } = testApp(session)

    const list = await app.request('/api/v1/auth/passkeys')
    expect(await list.json()).toEqual({ items: [passkey] })
    expect(kanso.passkeys.list).toHaveBeenCalledWith(7)

    const options = await app.request('/api/v1/auth/passkeys/options', json('POST'))
    expect(await options.json()).toEqual({ options: { challenge: 'register' } })
    expect(kanso.passkeys.registerOptions).toHaveBeenCalledWith(7, rp)

    const added = await app.request(
      '/api/v1/auth/passkeys',
      json('POST', { credential: registration, name: 'Windows' }),
    )
    expect(added.status).toBe(201)
    expect(await added.json()).toEqual({ item: passkey })
    expect(kanso.passkeys.finishRegister).toHaveBeenCalledWith(7, registration, rp, 'Windows')

    const renamed = await app.request('/api/v1/auth/passkeys/3', json('PATCH', { name: 'Phone' }))
    expect(await renamed.json()).toEqual({ item: { ...passkey, name: 'Phone' } })
    expect(kanso.passkeys.rename).toHaveBeenCalledWith(7, 3, 'Phone')

    const removed = await app.request('/api/v1/auth/passkeys/3', json('DELETE'))
    expect(removed.status).toBe(200)
    expect(kanso.passkeys.remove).toHaveBeenCalledWith(7, 3)
  })

  it('refuses to remove the last passkey', async () => {
    const { app, kanso } = testApp(session)
    vi.mocked(kanso.passkeys.remove).mockRejectedValue(
      KansoError.conflict('The last passkey cannot be removed'),
    )
    const response = await app.request('/api/v1/auth/passkeys/3', json('DELETE'))
    expect(response.status).toBe(409)
  })

  it('needs a session, not an API key', async () => {
    expect((await testApp().app.request('/api/v1/auth/passkeys')).status).toBe(401)
    const { app, kanso } = testApp(apiKey)
    expect((await app.request('/api/v1/auth/passkeys')).status).toBe(403)
    expect((await app.request('/api/v1/auth/passkeys/options', json('POST'))).status).toBe(403)
    expect(kanso.passkeys.registerOptions).not.toHaveBeenCalled()
  })

  it('rejects cross-site changes', async () => {
    const { app, kanso } = testApp(session)
    const response = await app.request(
      '/api/v1/auth/passkeys/3',
      json('DELETE', undefined, { 'sec-fetch-site': 'cross-site' }),
    )
    expect(response.status).toBe(403)
    expect(kanso.passkeys.remove).not.toHaveBeenCalled()
  })
})

describe('author profile', () => {
  it('returns and updates the session user profile', async () => {
    const { app, kanso } = testApp(session)

    const got = await app.request('/api/v1/auth/profile')
    expect(got.status).toBe(200)
    expect(await got.json()).toEqual({
      profile: { slug: 'editor', bio: 'Hello', avatarMediaId: null },
    })
    expect(kanso.auth.getProfile).toHaveBeenCalledWith(7)

    const updated = await app.request(
      '/api/v1/auth/profile',
      json('PATCH', { slug: 'taro-editor', bio: 'New bio', avatarMediaId: 5 }),
    )
    expect(updated.status).toBe(200)
    expect(kanso.auth.updateProfile).toHaveBeenCalledWith(7, {
      slug: 'taro-editor',
      bio: 'New bio',
      avatarMediaId: 5,
    })
  })

  it('rejects an invalid slug format', async () => {
    const { app, kanso } = testApp(session)
    const response = await app.request(
      '/api/v1/auth/profile',
      json('PATCH', { slug: 'Not A Slug!' }),
    )
    expect(response.status).toBe(400)
    expect(kanso.auth.updateProfile).not.toHaveBeenCalled()
  })

  it('needs a session, not an API key', async () => {
    const { app, kanso } = testApp(apiKey)
    expect((await app.request('/api/v1/auth/profile')).status).toBe(403)
    expect((await app.request('/api/v1/auth/profile', json('PATCH', { slug: 'x' }))).status).toBe(
      403,
    )
    expect(kanso.auth.updateProfile).not.toHaveBeenCalled()
  })
})

describe('passkey links', () => {
  it('shows whose passkey the link registers', async () => {
    const { app, kanso } = testApp()
    const response = await app.request(
      '/api/v1/auth/passkey-link/options',
      json('POST', { token: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    )
    expect(await response.json()).toEqual({
      options: { challenge: 'link' },
      user: { email: user.email, name: user.name },
    })
    expect(kanso.passkeys.linkOptions).toHaveBeenCalledWith('aaaaaaaaaaaaaaaaaaaaaaaa', rp)
  })

  it('registers the passkey and signs the user in', async () => {
    const { app, kanso } = testApp()
    const response = await app.request(
      '/api/v1/auth/passkey-link',
      json('POST', { token: 'aaaaaaaaaaaaaaaaaaaaaaaa', credential: registration }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('kanso_session=new-session')
    expect(kanso.passkeys.finishLink).toHaveBeenCalledWith(
      'aaaaaaaaaaaaaaaaaaaaaaaa',
      registration,
      rp,
      undefined,
    )
  })

  it('answers 404 for an unknown or expired link', async () => {
    const { app, kanso } = testApp()
    vi.mocked(kanso.passkeys.linkOptions).mockRejectedValue(KansoError.notFound('Passkey link'))
    const response = await app.request(
      '/api/v1/auth/passkey-link/options',
      json('POST', { token: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    )
    expect(response.status).toBe(404)
  })
})
