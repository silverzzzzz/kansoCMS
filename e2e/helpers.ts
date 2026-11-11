import { execFileSync } from 'node:child_process'
import {
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  expect,
  type Page,
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
type MenuListResponse = { items: { id: number; slug: string; name: string }[] }
type UserListResponse = { items: { id: number; email: string }[] }
type MediaListResponse = { items: { id: number; filename: string }[] }
type PostTypeListResponse = { items: { id: number; slug: string }[] }
type PostListResponse = { items: { id: number }[] }

/** Menus a test creates use real slugs (`header`), so they are recognised by name instead. */
export const E2E_MENU_NAME_PREFIX = 'E2E '

/**
 * Chromium's virtual authenticator (CDP `WebAuthn`): a platform authenticator
 * with user verification that answers every prompt automatically. Each test
 * registers fresh credentials in it, so its counters never meet old ones.
 */
export async function addVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

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

async function listPages(request: APIRequestContext, trashed: boolean) {
  const pages: PageListResponse['items'] = []
  let page = 1
  let total = 0
  do {
    const response = await request.get('/api/v1/pages', {
      params: { page: String(page), perPage: '100', ...(trashed ? { trashed: 'true' } : {}) },
    })
    await expectOk(response)
    const result = (await response.json()) as PageListResponse
    pages.push(...result.items)
    total = result.total
    page += 1
  } while (pages.length < total)
  return pages
}

export async function cleanupE2E(request: APIRequestContext): Promise<void> {
  // Live pages and pages a test left in the trash. `force=true` purges: a plain
  // DELETE only moves a page to the trash.
  const pages = [...(await listPages(request, false)), ...(await listPages(request, true))]
  // Purging a parent re-homes its children, so order does not matter.
  for (const item of pages.filter((item) => item.slug.startsWith(E2E_PREFIX))) {
    const response = await request.delete(`/api/v1/pages/${item.id}`, {
      params: { force: 'true' },
    })
    await expectOk(response)
  }

  // Post types a test created, with their posts (live and trashed): a type can
  // only be deleted once it is empty.
  const typesResponse = await request.get('/api/v1/post-types')
  await expectOk(typesResponse)
  const types = (await typesResponse.json()) as PostTypeListResponse
  for (const type of types.items.filter((item) => item.slug.startsWith(E2E_PREFIX))) {
    for (const trashed of ['false', 'true']) {
      const postsResponse = await request.get('/api/v1/posts', {
        params: { type: type.slug, perPage: '100', trashed },
      })
      await expectOk(postsResponse)
      for (const post of ((await postsResponse.json()) as PostListResponse).items) {
        await expectOk(
          await request.delete(`/api/v1/posts/${post.id}`, { params: { force: 'true' } }),
        )
      }
    }
    await expectOk(await request.delete(`/api/v1/post-types/${type.id}`))
  }

  const menusResponse = await request.get('/api/v1/menus')
  await expectOk(menusResponse)
  const menus = (await menusResponse.json()) as MenuListResponse
  for (const item of menus.items.filter((menu) => menu.name.startsWith(E2E_MENU_NAME_PREFIX))) {
    await expectOk(await request.delete(`/api/v1/menus/${item.id}`))
  }

  const usersResponse = await request.get('/api/v1/users')
  await expectOk(usersResponse)
  const users = (await usersResponse.json()) as UserListResponse
  for (const item of users.items.filter(
    (user) => user.email.startsWith(E2E_PREFIX) && user.email !== E2E_EMAIL,
  )) {
    await expectOk(await request.delete(`/api/v1/users/${item.id}`))
  }

  const mediaResponse = await request.get('/api/v1/media', {
    params: { q: E2E_PREFIX, perPage: '100' },
  })
  await expectOk(mediaResponse)
  const media = (await mediaResponse.json()) as MediaListResponse
  for (const item of media.items.filter((file) => file.filename.startsWith(E2E_PREFIX))) {
    await expectOk(await request.delete(`/api/v1/media/${item.id}`))
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
