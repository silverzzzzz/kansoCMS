import { expect } from '@playwright/test'
import { test } from './editor-fixtures.ts'
import { uniqueSuffix } from './helpers.ts'

type FormListResponse = { items: { id: number; slug: string }[] }

test.describe('admin form publishing and submission', () => {
  test('publishes and submits an embedded form without JavaScript', async ({
    browser,
    page,
    api: apiRequest,
  }, testInfo) => {
    const suffix = uniqueSuffix()
    const formName = `E2E Contact ${suffix}`
    const formSlug = `e2e-contact-${suffix}`
    const pageTitle = `E2E Contact Page ${suffix}`
    const pageSlug = `e2e-page-${suffix}`

    await test.step('open the admin signed in', async () => {
      await page.goto('/_admin/')
      await expect(page.getByRole('heading', { level: 1, name: 'ダッシュボード' })).toBeAttached()
    })

    await test.step('create a form with two fields', async () => {
      await page.goto('/_admin/forms/new')
      const basics = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: '基本設定' }) })
      await basics.getByLabel('名前', { exact: true }).fill(formName)
      await page.getByLabel(/^スラッグ/).fill(formSlug)
      await page.getByLabel('完了メッセージ', { exact: true }).fill('E2E thanks')
      // The empty draft already has one field; add the second one.
      await page.getByRole('button', { name: 'フィールドを追加', exact: true }).click()

      // Each field row has its own 名前 and 種類.
      const fieldRows = page.locator(
        'div.mt-4.space-y-4 > div.border.border-neutral-200.bg-white.p-5',
      )
      await expect(fieldRows).toHaveCount(2)
      await page.getByRole('button', { name: 'フィールドを追加', exact: true }).click()
      const extra = fieldRows.nth(2)
      await expect(extra.getByRole('button', { name: 'フィールドを削除' })).toBeHidden()
      await extra.getByRole('button', { name: 'フィールド 3 のその他の操作' }).click()
      await extra.getByRole('button', { name: 'フィールドを削除' }).click()
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
      await expect(page).toHaveURL(/\/_admin\/forms\/\d+\/?$/)
      await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
    })

    await test.step('publish a page with the form-picker dialog', async () => {
      await page.goto('/_admin/pages/new')
      await page.getByLabel('タイトル', { exact: true }).fill(pageTitle)
      await page.getByLabel('スラッグ', { exact: true }).fill(pageSlug)
      await page.getByLabel(/^状態/).selectOption('published')

      const editor = page.locator('.editor-content .ProseMirror')
      await editor.fill('Contact us')
      await page.getByRole('combobox', { name: '挿入', exact: true }).selectOption('form')

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: 'フォームを選択' })).toBeVisible()
      await dialog.getByRole('button').filter({ hasText: formSlug }).click()
      await expect(page.locator('.editor-form-block')).toHaveText(`フォーム: ${formSlug}`)

      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page).toHaveURL(/\/_admin\/pages\/\d+\/?$/)
      await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(pageTitle)
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

      await page.goto(`/_admin/forms/${form.id}/submissions`)
      const row = page
        .getByRole('row')
        .filter({ hasText: 'E2E Tester' })
        .filter({ hasText: 'e2e@example.com' })
      await expect(row).toContainText('未読')
    })
  })
})
