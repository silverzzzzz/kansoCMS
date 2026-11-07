import { type APIRequestContext, expect, test } from '@playwright/test'
import {
  apiLogin,
  cleanupE2E,
  E2E_EMAIL,
  E2E_PASSWORD,
  ensureAdmin,
  uniqueSuffix,
} from './helpers.ts'

type PageResponse = { item: { id: number } }

test.describe('customize editor', () => {
  let apiRequest: APIRequestContext
  let apiAuthenticated = false

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
    await cleanupE2E(apiRequest)
  })

  test.afterAll(async () => {
    try {
      if (apiAuthenticated) await cleanupE2E(apiRequest)
    } finally {
      await apiRequest?.dispose()
    }
  })

  test('builds a page from sections and publishes it', async ({ page }) => {
    const suffix = uniqueSuffix()
    const pageTitle = `E2E Customize ${suffix}`
    const pageSlug = `e2e-customize-${suffix}`
    const heading = `E2E hero heading ${suffix}`
    const ctaLabel = `E2E CTA ${suffix}`
    let pageId = 0

    await test.step('create a published page over the API', async () => {
      const response = await apiRequest.post('/api/v1/pages', {
        data: { title: pageTitle, slug: pageSlug, status: 'published' },
      })
      expect(response.status(), await response.text()).toBe(201)
      pageId = ((await response.json()) as PageResponse).item.id
    })

    await test.step('log in through the admin UI', async () => {
      await page.goto('/admin/login')
      await page.getByLabel('メールアドレス', { exact: true }).fill(E2E_EMAIL)
      await page.getByLabel('パスワード', { exact: true }).fill(E2E_PASSWORD)
      await page.getByRole('button', { name: 'ログイン', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/$/)
    })

    await test.step('add hero and CTA sections with a live preview', async () => {
      await page.goto(`/admin/customize?page=${pageId}`)
      await expect(page.getByRole('heading', { name: 'カスタマイズ' })).toBeVisible()

      await page.getByLabel('追加するセクション').selectOption('hero')
      await page.getByRole('button', { name: '追加', exact: true }).click()
      await page.getByLabel('Heading', { exact: true }).fill(heading)

      const preview = page.frameLocator('iframe[title="プレビュー"]')
      await expect(preview.getByRole('heading', { name: heading })).toBeVisible()

      await page.getByLabel('追加するセクション').selectOption('cta')
      await page.getByRole('button', { name: '追加', exact: true }).click()
      await page.getByLabel('Button label', { exact: true }).fill(ctaLabel)
      await page.getByLabel('Button link', { exact: true }).fill('/contact')
    })

    await test.step('reorder, save and verify the public page', async () => {
      // Move the CTA above the hero, then back, exercising the reorder buttons.
      const rows = page.locator('li', { has: page.getByRole('button', { name: 'Call to action' }) })
      await rows.getByRole('button', { name: '上へ移動' }).click()
      await rows.getByRole('button', { name: '下へ移動' }).click()

      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByText('保存しました')).toBeVisible()

      const publicResponse = await apiRequest.get(`/${pageSlug}`)
      expect(publicResponse.status()).toBe(200)
      const html = await publicResponse.text()
      expect(html).toContain('class="page-sections"')
      expect(html).toContain(heading)
      expect(html).toContain(ctaLabel)
    })

    await test.step('edit theme settings and see them on the public site', async () => {
      const footerText = `E2E footer ${suffix}`
      await page.getByRole('button', { name: 'テーマ設定', exact: true }).click()
      await page.getByLabel('Footer text', { exact: true }).fill(footerText)
      await page.getByRole('button', { name: 'テーマ設定を保存', exact: true }).click()
      // Saving clears the dirty state, which disables the save button again.
      await expect(
        page.getByRole('button', { name: 'テーマ設定を保存', exact: true }),
      ).toBeDisabled()

      const publicResponse = await apiRequest.get(`/${pageSlug}`)
      expect(await publicResponse.text()).toContain(footerText)

      const reset = await apiRequest.put('/api/v1/settings/theme', { data: {} })
      expect(reset.status()).toBe(200)
      await page.getByRole('button', { name: 'セクション', exact: true }).click()
    })

    await test.step('detach sections to return to the rich text body', async () => {
      await page.getByRole('button', { name: 'セクションをやめて本文に戻す' }).click()
      await page.getByRole('dialog').getByRole('button', { name: '本文に戻す' }).click()
      await expect(
        page.getByText('このページは現在リッチテキスト本文で表示されています', { exact: false }),
      ).toBeVisible()

      const publicResponse = await apiRequest.get(`/${pageSlug}`)
      const html = await publicResponse.text()
      expect(html).not.toContain('class="page-sections"')
    })
  })
})
