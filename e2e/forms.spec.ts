import { type APIRequestContext, expect, test } from '@playwright/test'
import {
  apiLogin,
  cleanupE2E,
  E2E_EMAIL,
  E2E_PASSWORD,
  ensureAdmin,
  uniqueSuffix,
} from './helpers.ts'

type FormListResponse = { items: { id: number; slug: string }[] }

test.describe('admin form publishing and submission', () => {
  let apiRequest: APIRequestContext
  let apiAuthenticated = false

  test.beforeAll(async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Playwright baseURL is not configured')
    // A dedicated context: the built-in `request` fixture does not keep its cookie across hooks.
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

  test('publishes and submits an embedded form without JavaScript', async ({
    browser,
    page,
  }, testInfo) => {
    const suffix = uniqueSuffix()
    const formName = `E2E Contact ${suffix}`
    const formSlug = `e2e-contact-${suffix}`
    const pageTitle = `E2E Contact Page ${suffix}`
    const pageSlug = `e2e-page-${suffix}`

    await test.step('log in through the admin UI', async () => {
      await page.goto('/admin/login')
      await expect(page.getByRole('heading', { name: '管理画面にログイン' })).toBeVisible()
      await page.getByLabel('メールアドレス', { exact: true }).fill(E2E_EMAIL)
      await page.getByLabel('パスワード', { exact: true }).fill(E2E_PASSWORD)
      await page.getByRole('button', { name: 'ログイン', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/$/)
      await expect(page.getByRole('heading', { name: /^おかえりなさい、/ })).toBeVisible()
    })

    await test.step('create a form with two fields', async () => {
      await page.goto('/admin/forms/new')
      await page.getByLabel('名前', { exact: true }).fill(formName)
      await page.getByLabel(/^スラッグ/).fill(formSlug)
      await page.getByLabel('完了メッセージ', { exact: true }).fill('E2E thanks')
      // The empty draft already has one field; add the second one.
      await page.getByRole('button', { name: 'フィールドを追加', exact: true }).click()

      // Per-field labels (名前, 種類, …) carry hints in their accessible names, so scope by row.
      const fieldRows = page.locator(
        'div.mt-4.space-y-4 > div.border.border-neutral-200.bg-white.p-5',
      )
      await expect(fieldRows).toHaveCount(2)

      const nameField = fieldRows.nth(0)
      await nameField.getByLabel('ラベル', { exact: true }).fill('お名前')
      await nameField.getByLabel(/^名前/).fill('name')
      await nameField.getByLabel('必須', { exact: true }).check()

      const emailField = fieldRows.nth(1)
      await emailField.getByLabel(/^種類/).selectOption('email')
      await emailField.getByLabel('ラベル', { exact: true }).fill('メール')
      await emailField.getByLabel(/^名前/).fill('email')

      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/forms\/?$/)
      await expect(page.getByRole('link', { name: formName, exact: true })).toBeVisible()
    })

    await test.step('publish a page with the form-picker dialog', async () => {
      await page.goto('/admin/pages/new')
      await page.getByLabel('タイトル', { exact: true }).fill(pageTitle)
      await page.getByLabel('スラッグ', { exact: true }).fill(pageSlug)
      await page.getByLabel(/^状態/).selectOption('published')

      const editor = page.locator('.editor-content .ProseMirror')
      await editor.fill('Contact us')
      await page.getByRole('button', { name: 'フォーム', exact: true }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: 'フォームを選択' })).toBeVisible()
      await dialog.getByRole('button').filter({ hasText: formSlug }).click()
      await expect(page.locator('.editor-form-block')).toHaveText(`フォーム: ${formSlug}`)

      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/pages\/?$/)
      await expect(page.getByRole('link', { name: pageTitle, exact: true })).toBeVisible()
    })

    await test.step('validate and submit the public form without page JavaScript', async () => {
      const baseURL = testInfo.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Playwright baseURL is not configured')
      // No cookies (so the page comes through the public cache) and no scripts.
      const publicContext = await browser.newContext({ javaScriptEnabled: false, baseURL })
      const publicPage = await publicContext.newPage()
      try {
        await publicPage.goto(`/${pageSlug}`)
        const form = publicPage.locator('form.kanso-form')
        const publicNameInput = publicPage.getByRole('textbox', { name: /^お名前/ })
        const publicEmailInput = publicPage.getByRole('textbox', { name: /^メール/ })
        await expect(form).toBeVisible()
        await expect(publicNameInput).toBeVisible()
        await expect(publicEmailInput).toBeVisible()

        // Native required validation would stop the deliberately invalid request before it reaches
        // the server. This disables only browser constraint validation; page JavaScript stays off.
        await form.evaluate((element: HTMLFormElement) => {
          element.noValidate = true
        })
        const isFormPost = (response: { request(): { method(): string }; url(): string }) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `/${pageSlug}`
        const invalidResponsePromise = publicPage.waitForResponse(isFormPost)
        await form.getByRole('button', { name: /^(送信|Send)$/ }).click()
        expect((await invalidResponsePromise).status()).toBe(422)

        const publicNameField = publicPage
          .locator('.kanso-form__field')
          .filter({ has: publicNameInput })
        await expect(publicNameField.locator('.kanso-form__error')).toBeVisible()
        await expect(publicPage.locator('form.kanso-form')).toBeVisible()

        await publicNameInput.fill('E2E Tester')
        await publicEmailInput.fill('e2e@example.com')
        const successResponsePromise = publicPage.waitForResponse(isFormPost)
        await publicPage.getByRole('button', { name: /^(送信|Send)$/ }).click()
        expect((await successResponsePromise).status()).toBe(200)
        await expect(publicPage.locator('.kanso-form--success')).toContainText('E2E thanks')
      } finally {
        await publicContext.close()
      }
    })

    await test.step('show the unread submission in the admin list', async () => {
      const response = await apiRequest.get('/api/v1/forms')
      expect(response.status()).toBe(200)
      const forms = (await response.json()) as FormListResponse
      const form = forms.items.find((item) => item.slug === formSlug)
      if (!form) throw new Error(`Created form was not found: ${formSlug}`)

      await page.goto(`/admin/forms/${form.id}/submissions`)
      const row = page
        .getByRole('row')
        .filter({ hasText: 'E2E Tester' })
        .filter({ hasText: 'e2e@example.com' })
      await expect(row).toContainText('未読')
    })
  })
})
