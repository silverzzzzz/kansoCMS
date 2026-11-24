import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import {
  addVirtualAuthenticator,
  apiLogin,
  E2E_EMAIL,
  E2E_PREFIX,
  ensureAdmin,
  issuePasskeyLink,
  shareSession,
  uniqueSuffix,
} from './helpers.ts'

type PasskeyList = { items: { id: number; name: string }[] }

async function renameNewestPasskey(page: Page, name: string): Promise<void> {
  const rows = page.locator('tbody tr')
  await rows.last().getByRole('button', { name: '名前を変更' }).click()
  await page.getByLabel('パスキーの名前').fill(name)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible()
}

async function removePasskey(page: Page, name: string): Promise<void> {
  const row = page.locator('tbody tr').filter({ hasText: name })
  await row.getByRole('button', { name: '削除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '削除', exact: true }).click()
  await expect(page.getByText(`パスキー「${name}」を削除しました。`)).toBeVisible()
  await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(0)
}

test.describe('passkeys', () => {
  let apiRequest: APIRequestContext
  let apiAuthenticated = false

  async function removeTestPasskeys() {
    const response = await apiRequest.get('/api/v1/auth/passkeys')
    expect(response.status(), await response.text()).toBe(200)
    const { items } = (await response.json()) as PasskeyList
    for (const item of items.filter((passkey) => passkey.name.startsWith(E2E_PREFIX))) {
      await apiRequest.delete(`/api/v1/auth/passkeys/${item.id}`)
    }
  }

  test.beforeAll(async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Playwright baseURL is not configured')
    apiRequest = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { origin: baseURL },
    })
    await ensureAdmin(apiRequest)
    await apiLogin(apiRequest)
    apiAuthenticated = true
  })

  test.afterAll(async () => {
    try {
      // The first test signs the shared session out in the browser, so sign in again.
      if (apiAuthenticated) {
        await apiLogin(apiRequest)
        await removeTestPasskeys()
      }
    } finally {
      await apiRequest?.dispose()
    }
  })

  test('adds a passkey, signs in with it and removes it', async ({ page }) => {
    const name = `${E2E_PREFIX}passkey-${uniqueSuffix()}`
    await addVirtualAuthenticator(page)

    await test.step('add a passkey on the account screen', async () => {
      await shareSession(page.context(), apiRequest)
      await page.goto('/admin/account')
      await expect(page.getByRole('heading', { name: 'アカウント' })).toBeVisible()
      await expect(page.getByText(E2E_EMAIL)).toBeVisible()
      await page.getByRole('button', { name: 'パスキーを追加' }).click()
      await expect(page.getByText(/^パスキー「.+」を追加しました。$/)).toBeVisible()
      await renameNewestPasskey(page, name)
    })

    await test.step('sign out and sign in with the new passkey', async () => {
      await page.getByRole('button', { name: 'ログアウト' }).click()
      await expect(page).toHaveURL(/\/admin\/login/)
      await page.getByRole('button', { name: 'パスキーでログイン' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'ダッシュボード' })).toBeAttached()
    })

    await test.step('the passkey shows when it was used, and can be removed', async () => {
      await page.goto('/admin/account')
      const row = page.locator('tbody tr').filter({ hasText: name })
      await expect(row).toBeVisible()
      await expect(row.getByRole('cell', { name: '未使用' })).toHaveCount(0)
      await removePasskey(page, name)
    })
  })

  test('registers a passkey from a one-time link', async ({ browser }, testInfo) => {
    const baseURL = String(testInfo.project.use.baseURL)
    const name = `${E2E_PREFIX}link-${uniqueSuffix()}`
    const link = issuePasskeyLink(baseURL)
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await addVirtualAuthenticator(page)

      await test.step('open the link signed out and create a passkey', async () => {
        await page.goto(link)
        await expect(page.getByRole('heading', { name: 'パスキーを登録' })).toBeVisible()
        await expect(page.getByText(`(${E2E_EMAIL})`)).toBeVisible()
        await page.getByRole('button', { name: 'パスキーを作成してログイン' }).click()
        await expect(page).toHaveURL(/\/admin\/account$/)
        await renameNewestPasskey(page, name)
      })

      await test.step('the link works only once', async () => {
        await page.goto(link)
        await expect(page.getByText(/このリンクは無効か、有効期限が切れています/)).toBeVisible()
      })

      await test.step('remove the passkey again', async () => {
        await page.goto('/admin/account')
        await removePasskey(page, name)
      })
    } finally {
      await context.close()
    }
  })
})
