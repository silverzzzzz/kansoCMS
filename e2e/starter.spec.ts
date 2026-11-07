import { type APIRequestContext, expect, test } from '@playwright/test'
import { apiLogin, E2E_EMAIL, E2E_PASSWORD, ensureAdmin } from './helpers.ts'

type StarterStatus = { installed: boolean }
type InstallResult = {
  created: Record<string, number>
  skipped: { kind: 'page' | 'postType' | 'form'; slug: string }[]
}

test.describe('starter site', () => {
  let apiRequest: APIRequestContext
  let apiAuthenticated = false
  // A developer database may already hold the starter site; never remove theirs.
  let installedBefore = false
  let installedByTest = false

  async function starterInstalled(): Promise<boolean> {
    const response = await apiRequest.get('/api/v1/starter')
    expect(response.status(), await response.text()).toBe(200)
    return ((await response.json()) as StarterStatus).installed
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
    installedBefore = await starterInstalled()
  })

  test.afterAll(async () => {
    try {
      // Leave the database as found if the test stopped between install and removal.
      if (apiAuthenticated && installedByTest && (await starterInstalled())) {
        const response = await apiRequest.delete('/api/v1/starter')
        expect(response.status(), await response.text()).toBe(200)
      }
    } finally {
      await apiRequest?.dispose()
    }
  })

  test('installs the starter site from the settings screen and removes it again', async ({
    page,
  }) => {
    test.skip(installedBefore, 'The starter site is already installed in this database.')
    let result: InstallResult = { created: {}, skipped: [] }
    const skipped = (kind: InstallResult['skipped'][number]['kind'], slug: string) =>
      result.skipped.some((item) => item.kind === kind && item.slug === slug)
    const createdPages = () =>
      ['home', 'about', 'services', 'contact'].filter((slug) => !skipped('page', slug))

    await test.step('log in through the admin UI', async () => {
      await page.goto('/admin/login')
      await page.getByLabel('メールアドレス', { exact: true }).fill(E2E_EMAIL)
      await page.getByLabel('パスワード', { exact: true }).fill(E2E_PASSWORD)
      await page.getByRole('button', { name: 'ログイン', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/$/)
    })

    await test.step('install the starter site from the settings screen', async () => {
      await page.goto('/admin/settings')
      await expect(page.getByRole('heading', { name: 'サンプルサイト' })).toBeVisible()
      const installed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/starter') && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'サンプルサイトを入れる' }).click()
      const response = await installed
      expect(response.status()).toBe(201)
      installedByTest = true
      result = (await response.json()) as InstallResult
      expect(result.created.media).toBe(7)
      await expect(page.getByText('サンプルサイトを作成しました')).toBeVisible()
      await expect(page.getByRole('button', { name: 'サンプルを削除' })).toBeVisible()
    })

    await test.step('show the starter content on the public site', async () => {
      if (!skipped('page', 'home')) {
        const html = await (await apiRequest.get('/')).text()
        expect(html).toContain('class="page-sections"')
        expect(html).toContain('お気軽にご相談ください')
      }
      if (!skipped('page', 'about')) {
        const about = await apiRequest.get('/about')
        expect(about.status()).toBe(200)
        expect(await about.text()).toContain('（サンプル）')
      }
      if (!skipped('page', 'contact')) {
        expect(await (await apiRequest.get('/contact')).text()).toContain('kanso-form')
      }
      if (!skipped('postType', 'news')) {
        const news = await apiRequest.get('/news')
        expect(news.status()).toBe(200)
        expect(await news.text()).toContain('サイトの編集方法')
      }
    })

    await test.step('point the dashboard at the starter site', async () => {
      await page.goto('/admin/')
      await expect(
        page.getByRole('heading', { name: 'サンプルサイトが入っています' }),
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'サイトを見る' })).toHaveAttribute('href', '/')
      if (!skipped('page', 'home')) {
        await page.getByRole('link', { name: 'トップページをカスタマイズ' }).click()
        await expect(page).toHaveURL(/\/admin\/customize\?page=\d+/)
        await expect(page.getByRole('heading', { name: 'カスタマイズ' })).toBeVisible()
        const preview = page.frameLocator('iframe[title="プレビュー"]')
        await expect(preview.getByRole('heading', { name: 'お気軽にご相談ください' })).toBeVisible()
      }
    })

    await test.step('remove the starter site from the settings screen', async () => {
      await page.goto('/admin/settings')
      await page.getByRole('button', { name: 'サンプルを削除' }).click()
      await page.getByRole('dialog').getByRole('button', { name: '削除', exact: true }).click()
      await expect(page.getByText('サンプルを削除しました')).toBeVisible()
      await expect(page.getByRole('button', { name: 'サンプルサイトを入れる' })).toBeVisible()
      expect(await starterInstalled()).toBe(false)
      installedByTest = false

      for (const slug of createdPages().filter((slug) => slug !== 'home')) {
        expect((await apiRequest.get(`/${slug}`)).status(), slug).toBe(404)
      }
      if (!skipped('postType', 'news')) {
        expect((await apiRequest.get('/news/how-to-edit')).status()).toBe(404)
      }
      await page.goto('/admin/')
      await expect(page.getByRole('heading', { name: 'サンプルサイトが入っています' })).toHaveCount(
        0,
      )
    })
  })
})
