import { type APIRequestContext, expect } from '@playwright/test'

export const E2E_EMAIL = 'admin@example.com'
export const E2E_PASSWORD = 'password123'
export const E2E_PREFIX = 'e2e-'

type SetupResponse = { needed: boolean }
type FormListResponse = { items: { id: number; slug: string }[] }
type PageListResponse = { items: { id: number; slug: string }[]; total: number }

async function expectOk(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  if (response.ok()) return
  expect(response.ok(), await response.text()).toBe(true)
}

export async function ensureAdmin(request: APIRequestContext): Promise<void> {
  const statusResponse = await request.get('/api/v1/setup')
  await expectOk(statusResponse)
  const status = (await statusResponse.json()) as SetupResponse
  if (!status.needed) return

  const setupResponse = await request.post('/api/v1/setup', {
    data: {
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      name: 'E2E Admin',
      siteTitle: 'kansoCMS',
    },
  })
  await expectOk(setupResponse)
}

export async function apiLogin(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/v1/auth/login', {
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  })
  expect(response.status(), await response.text()).toBe(200)
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
