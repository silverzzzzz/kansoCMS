import { execFileSync } from 'node:child_process'
import {
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  expect,
} from '@playwright/test'
import { SoftAuthenticator } from '../packages/core/src/auth/soft-authenticator.ts'

export const E2E_EMAIL = 'admin@example.com'
export const E2E_PREFIX = 'e2e-'

/**
 * The E2E admin's passkey: a software authenticator with a fixed, test-only
 * P-256 key (counter 0, like a synced passkey). It is only ever registered in
 * local and CI test databases, the way a fixed test password used to be.
 */
const E2E_PASSKEY = {
  credentialId: 'n-msp2E6Y-byEQiazfClLg',
  privateKey: {
    kty: 'EC',
    crv: 'P-256',
    x: '98-o3WBCdCPuOPFzpjp97NOn1fbCGxHl0GBsLtiIvTk',
    y: 'TlxVT7kpDSDe9jPfQaIm5bFTLj_ziKB_tmKErWpE8f4',
    d: 'n-rwUw7LJzo0HvCUVdT_F-5b7aTI_9sUB6gI4J3_yQs',
  },
}

type SetupResponse = { needed: boolean }
type FormListResponse = { items: { id: number; slug: string }[] }
type PageListResponse = { items: { id: number; slug: string }[]; total: number }

async function expectOk(response: APIResponse) {
  if (response.ok()) return
  expect(response.ok(), await response.text()).toBe(true)
}

function e2ePasskey() {
  return SoftAuthenticator.create(E2E_PASSKEY)
}

function originOf(response: APIResponse): string {
  return new URL(response.url()).origin
}

export async function ensureAdmin(request: APIRequestContext): Promise<void> {
  const statusResponse = await request.get('/api/v1/setup')
  await expectOk(statusResponse)
  const status = (await statusResponse.json()) as SetupResponse
  if (!status.needed) return

  const optionsResponse = await request.post('/api/v1/setup/options', {
    data: { email: E2E_EMAIL, name: 'E2E Admin', siteTitle: 'kansoCMS' },
  })
  await expectOk(optionsResponse)
  const { options } = await optionsResponse.json()
  const credential = await (await e2ePasskey()).register(options, originOf(optionsResponse))
  const setupResponse = await request.post('/api/v1/setup', {
    data: { credential, passkeyName: 'E2E' },
  })
  await expectOk(setupResponse)
}

async function passkeySignIn(request: APIRequestContext): Promise<APIResponse> {
  const optionsResponse = await request.post('/api/v1/auth/passkey/options')
  await expectOk(optionsResponse)
  const { options } = await optionsResponse.json()
  const credential = await (await e2ePasskey()).authenticate(options, originOf(optionsResponse))
  return request.post('/api/v1/auth/passkey', { data: { credential } })
}

/** Runs `pnpm passkey:link` for the E2E admin against the local D1 and returns the link. */
export function issuePasskeyLink(origin: string): string {
  const output = execFileSync(
    process.execPath,
    ['apps/server/scripts/passkey-link.mjs', E2E_EMAIL, '--url', origin],
    { encoding: 'utf8' },
  )
  const link = /https?:\/\/\S+token=[A-Za-z0-9_-]+/.exec(output)?.[0]
  if (!link) throw new Error(`passkey:link printed no link:\n${output}`)
  return link
}

/**
 * Registers the E2E passkey through a one-time link from `pnpm passkey:link`
 * (local D1), which also signs in. Needed when the E2E admin exists without
 * it, e.g. a developer database that was created before passkeys.
 */
async function registerWithLink(request: APIRequestContext, origin: string): Promise<void> {
  const token = new URL(issuePasskeyLink(origin)).searchParams.get('token')

  const optionsResponse = await request.post('/api/v1/auth/passkey-link/options', {
    data: { token },
  })
  await expectOk(optionsResponse)
  const { options } = await optionsResponse.json()
  const credential = await (await e2ePasskey()).register(options, origin)
  const response = await request.post('/api/v1/auth/passkey-link', {
    data: { token, credential, passkeyName: 'E2E' },
  })
  await expectOk(response)
}

export async function apiLogin(request: APIRequestContext): Promise<void> {
  const response = await passkeySignIn(request)
  if (response.status() === 401 && /not registered/.test(await response.text())) {
    await registerWithLink(request, originOf(response))
    return
  }
  expect(response.status(), await response.text()).toBe(200)
}

/** Signs a browser context in with the API context's session cookie. */
export async function shareSession(
  context: BrowserContext,
  request: APIRequestContext,
): Promise<void> {
  await context.addCookies((await request.storageState()).cookies)
}

export async function cleanupE2E(request: APIRequestContext): Promise<void> {
  const pages: PageListResponse['items'] = []
  let page = 1
  let total = 0
  do {
    const response = await request.get('/api/v1/pages', {
      params: { page: String(page), perPage: '100' },
    })
    await expectOk(response)
    const result = (await response.json()) as PageListResponse
    pages.push(...result.items)
    total = result.total
    page += 1
  } while (pages.length < total)

  // Deleting a parent only nulls its children's parentId, so order does not matter.
  for (const item of pages.filter((item) => item.slug.startsWith(E2E_PREFIX))) {
    const response = await request.delete(`/api/v1/pages/${item.id}`)
    await expectOk(response)
  }

  const formsResponse = await request.get('/api/v1/forms')
  await expectOk(formsResponse)
  const forms = (await formsResponse.json()) as FormListResponse
  for (const item of forms.items.filter((form) => form.slug.startsWith(E2E_PREFIX))) {
    const response = await request.delete(`/api/v1/forms/${item.id}`)
    await expectOk(response)
  }
}

export function uniqueSuffix(): string {
  return Date.now().toString(36)
}
