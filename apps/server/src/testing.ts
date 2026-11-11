import { createTestKanso } from '@kanso/core/testing'
import { vi } from 'vitest'
import { app } from './app.ts'
import type { Bindings } from './env.ts'

export const TEST_ORIGIN = 'https://example.com'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0 Safari/537.36'

/**
 * The whole Worker (`app`) over an in-memory database and bucket, for tests
 * that should run real SQL through the real routes and middleware. Optional
 * bindings (e.g. `AI`) can be passed through `bindings`.
 */
export function createTestApp(bindings: Record<string, unknown> = {}) {
  const test = createTestKanso()
  const pending: Promise<unknown>[] = []
  const env = {
    DB: test.d1,
    MEDIA: test.bucket,
    ASSETS: { fetch: () => Promise.resolve(new Response('', { status: 404 })) },
    EMAIL: { send: vi.fn().mockResolvedValue(undefined) },
    SITE_URL: TEST_ORIGIN,
    ...bindings,
  } as unknown as Bindings
  const executionCtx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise)
    },
    passThroughOnException: () => {},
    props: {},
  }

  let cookie = ''

  async function request(
    path: string,
    init: {
      method?: string
      json?: unknown
      body?: BodyInit
      headers?: Record<string, string>
    } = {},
  ) {
    const headers: Record<string, string> = {
      'user-agent': BROWSER_UA,
      // What a browser sends for a same-origin request (the CSRF check reads it).
      'sec-fetch-site': 'same-origin',
      origin: TEST_ORIGIN,
      ...(cookie ? { cookie } : {}),
      ...(init.json === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    }
    return app.request(
      new URL(path, TEST_ORIGIN).toString(),
      {
        method: init.method ?? 'GET',
        headers,
        body: init.json === undefined ? init.body : JSON.stringify(init.json),
      },
      env,
      executionCtx,
    )
  }

  /** Create a user with a session and send its cookie on later requests. */
  async function signIn(
    options: { role?: 'admin' | 'editor'; email?: string; name?: string } = {},
  ) {
    const email = options.email ?? `${options.role ?? 'admin'}@example.com`
    test.exec(
      `insert into users (email, name, role, slug) values ('${email}', '${options.name ?? 'Tester'}', '${options.role ?? 'admin'}', '${email.split('@')[0]}')`,
    )
    const user = await test.kanso.auth.findUserByEmail(email)
    if (!user) throw new Error('Test user was not created')
    const session = await test.kanso.auth.createSession(user.id)
    cookie = `kanso_session=${session.token}`
    return user
  }

  return {
    ...test,
    env,
    request,
    signIn,
    signOut: () => {
      cookie = ''
    },
    /** Continue as whoever a response just signed in (reads its `Set-Cookie`). */
    adoptSession: (response: Response) => {
      const session = /kanso_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1]
      if (!session) throw new Error('The response did not start a session')
      cookie = `kanso_session=${session}`
    },
    /** Wait for everything handed to `waitUntil`. */
    flush: async () => {
      while (pending.length > 0) await Promise.all(pending.splice(0))
    },
  }
}

export type TestApp = ReturnType<typeof createTestApp>

/** In-memory stand-in for `caches.default`; restore with `vi.unstubAllGlobals()`. */
export function stubSiteCache() {
  const entries = new Map<string, Response>()
  vi.stubGlobal('caches', {
    default: {
      match: async (key: string) => entries.get(key)?.clone(),
      put: async (key: string, response: Response) => {
        entries.set(key, response.clone())
      },
    },
  })
  return entries
}
