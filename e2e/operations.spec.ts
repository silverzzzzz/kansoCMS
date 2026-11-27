import { type APIRequestContext, expect, test } from '@playwright/test'
import {
  addVirtualAuthenticator,
  apiLogin,
  cleanupE2E,
  E2E_MENU_NAME_PREFIX,
  E2E_PREFIX,
  ensureAdmin,
  shareSession,
  uniqueSuffix,
} from './helpers.ts'

type PageItem = { item: { id: number; slug: string } }
type MenuList = { items: { slug: string }[] }
type MediaList = {
  items: { id: number; url: string; variants: { width: number; url: string }[] }[]
}

function body(text: string, image?: string) {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
      ...(image ? [{ type: 'image', attrs: { src: image, alt: 'E2E' } }] : []),
    ],
  }
}

/**
 * The features added from Phase 7 on, driven through the browser the way an
 * editor would: trash and restore, draft share links, the header menu,
 * export/import, inviting a user, and responsive image variants.
 */
test.describe('editorial operations', () => {
  let apiRequest: APIRequestContext
  let apiAuthenticated = false
  let baseURL = ''

  test.beforeAll(async ({ playwright }, testInfo) => {
    const configured = testInfo.project.use.baseURL
    if (typeof configured !== 'string') throw new Error('Playwright baseURL is not configured')
    baseURL = configured
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

  test.beforeEach(async ({ page }) => {
    await shareSession(page.context(), apiRequest)
  })

  async function createPage(data: Record<string, unknown>) {
    const response = await apiRequest.post('/api/v1/pages', { data })
    expect(response.status(), await response.text()).toBe(201)
    return ((await response.json()) as PageItem).item
  }

  test('moves a page to the trash and restores it', async ({ page }) => {
    const suffix = uniqueSuffix()
    const title = `E2E Trash ${suffix}`
    const slug = `${E2E_PREFIX}trash-${suffix}`
    const created = await createPage({ title, slug, status: 'published', bodyJson: body('trash') })

    await page.goto(`/_admin/pages/${created.id}`)
    await page.getByRole('button', { name: '固定ページのその他の操作' }).click()
    await page.getByRole('button', { name: 'ゴミ箱へ移動', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'ゴミ箱へ移動', exact: true })
      .click()
    await expect(page).toHaveURL(/\/_admin\/pages\/?$/)
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0)
    expect((await apiRequest.get(`/${slug}`)).status()).toBe(404)

    await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click()
    await expect(page.getByText(/日たつと、自動で完全に削除されます/)).toBeVisible()
    const row = page.locator('tbody tr').filter({ hasText: title })
    await row.getByRole('button', { name: '復元', exact: true }).click()
    await expect(row).toHaveCount(0)

    await page.getByRole('button', { name: '一覧', exact: true }).click()
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    expect((await apiRequest.get(`/${slug}`)).status()).toBe(200)
  })

  test('shares a draft through a link that can be revoked', async ({ browser, page }) => {
    const suffix = uniqueSuffix()
    const text = `E2E shared draft ${suffix}`
    const created = await createPage({
      title: `E2E Share ${suffix}`,
      slug: `${E2E_PREFIX}share-${suffix}`,
      status: 'draft',
      bodyJson: body(text),
    })

    await page.goto(`/_admin/pages/${created.id}`)
    await page.getByRole('button', { name: '共有リンクを発行', exact: true }).click()
    const issued = page.locator('input[readonly]')
    await expect(issued).toHaveValue(/\/preview\/share\//)
    const shared = new URL(await issued.inputValue())

    // Someone without an account.
    const visitor = await browser.newContext({ baseURL })
    try {
      const visitorPage = await visitor.newPage()
      const response = await visitorPage.goto(shared.pathname)
      expect(response?.status()).toBe(200)
      expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow')
      await expect(visitorPage.getByText(text)).toBeVisible()
      await expect(visitorPage.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, nofollow',
      )
      // The draft itself stays private.
      expect((await visitorPage.goto(`/${created.slug}`))?.status()).toBe(404)

      await page.getByRole('button', { name: '無効化', exact: true }).click()
      await expect(page.getByRole('button', { name: '無効化', exact: true })).toHaveCount(0)
      expect((await visitorPage.goto(shared.pathname))?.status()).toBe(404)
    } finally {
      await visitor.close()
    }
  })

  test('replaces the header navigation with a menu', async ({ browser, page }) => {
    const existing = (await (await apiRequest.get('/api/v1/menus')).json()) as MenuList
    test.skip(
      existing.items.some((menu) => menu.slug === 'header'),
      'this database already has a header menu',
    )
    const label = `E2E リンク ${uniqueSuffix()}`

    await page.goto('/_admin/menus/new')
    await page.getByLabel('名前', { exact: true }).fill(`${E2E_MENU_NAME_PREFIX}ヘッダー`)
    await page.getByLabel(/^スラッグ/).fill('header')
    await page.getByRole('button', { name: '+ 項目を追加', exact: true }).click()
    await page.getByLabel('項目 1 のラベル', { exact: true }).fill(label)
    await page.getByLabel('項目 1 のリンク先', { exact: true }).fill('/search')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page).toHaveURL(/\/_admin\/menus\/\d+\/?$/)

    const visitor = await browser.newContext({ baseURL })
    try {
      const visitorPage = await visitor.newPage()
      await visitorPage.goto('/')
      await expect(visitorPage.getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'href',
        '/search',
      )
    } finally {
      await visitor.close()
    }
  })

  test('exports the site and imports the file again', async ({ page }) => {
    const suffix = uniqueSuffix()
    const slug = `${E2E_PREFIX}export-${suffix}`
    const created = await createPage({
      title: `E2E Export ${suffix}`,
      slug,
      status: 'published',
      bodyJson: body(`exported ${suffix}`),
    })

    await page.goto('/_admin/tools')
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'JSON をダウンロード', exact: true }).click()
    const file = await (await downloading).path()

    // Lose the page for good, then bring it back from the file.
    const purged = await apiRequest.delete(`/api/v1/pages/${created.id}`, {
      params: { force: 'true' },
    })
    expect(purged.status()).toBe(200)
    expect((await apiRequest.get(`/${slug}`)).status()).toBe(404)

    await page.locator('input[type="file"]').setInputFiles(file)
    await page.getByRole('button', { name: 'インポート', exact: true }).click()
    await expect(page.getByText(/新規 1 件・更新 0 件/)).toBeVisible({ timeout: 30_000 })

    const restored = await apiRequest.get(`/${slug}`)
    expect(restored.status()).toBe(200)
    expect(await restored.text()).toContain(`exported ${suffix}`)
  })

  test('invites a user who signs in through the link as an editor', async ({ browser, page }) => {
    const suffix = uniqueSuffix()
    const name = `E2E Editor ${suffix}`
    const email = `${E2E_PREFIX}${suffix}@example.com`

    await page.goto('/_admin/users')
    await page.getByLabel('名前', { exact: true }).fill(name)
    await page.getByLabel('メールアドレス', { exact: true }).fill(email)
    await page.getByRole('button', { name: 'ユーザーを追加', exact: true }).click()
    const link = page.locator('code').filter({ hasText: '/_admin/passkey-link?token=' })
    await expect(link).toBeVisible()
    const invitation = new URL((await link.innerText()).trim())
    const row = page.locator('tbody tr').filter({ hasText: email })
    await expect(row).toContainText('登録待ち')

    const invitee = await browser.newContext({ baseURL })
    try {
      const inviteePage = await invitee.newPage()
      await addVirtualAuthenticator(inviteePage)
      await inviteePage.goto(`${invitation.pathname}${invitation.search}`)
      await inviteePage.getByRole('button', { name: 'パスキーを作成してログイン' }).click()
      await expect(inviteePage).toHaveURL(/\/_admin\/account\/?$/)
      await expect(inviteePage.getByText(email)).toBeVisible()
      // An editor has the content screens, not the administrator's.
      const nav = inviteePage.getByRole('navigation', { name: '管理メニュー', exact: true })
      await expect(nav.getByRole('link', { name: '固定ページ', exact: true })).toBeVisible()
      await expect(nav.getByRole('link', { name: '設定', exact: true })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'ユーザー', exact: true })).toHaveCount(0)
    } finally {
      await invitee.close()
    }

    await page.reload()
    await expect(page.locator('tbody tr').filter({ hasText: email })).toContainText('パスキー 1 個')
  })

  test('lets a second administrator step down to editor', async ({ browser, page }) => {
    const suffix = uniqueSuffix()
    const name = `E2E Admin ${suffix}`
    const email = `${E2E_PREFIX}admin-${suffix}@example.com`

    await page.goto('/_admin/users')
    await page.getByLabel('名前', { exact: true }).fill(name)
    await page.getByLabel('メールアドレス', { exact: true }).fill(email)
    // The only select of the invitation form (each row of the table has its own).
    await page.locator('form').getByRole('combobox').selectOption('admin')
    await page.getByRole('button', { name: 'ユーザーを追加', exact: true }).click()
    const link = page.locator('code').filter({ hasText: '/_admin/passkey-link?token=' })
    await expect(link).toBeVisible()
    const invitation = new URL((await link.innerText()).trim())

    const invitee = await browser.newContext({ baseURL })
    try {
      const inviteePage = await invitee.newPage()
      await addVirtualAuthenticator(inviteePage)
      await inviteePage.goto(`${invitation.pathname}${invitation.search}`)
      await inviteePage.getByRole('button', { name: 'パスキーを作成してログイン' }).click()
      await expect(inviteePage).toHaveURL(/\/_admin\/account\/?$/)

      // Giving up your own role asks first, then leaves the administrator's screens.
      await inviteePage.goto('/_admin/users')
      await inviteePage.getByLabel(`${name} の権限`, { exact: true }).selectOption('editor')
      const dialog = inviteePage.getByRole('dialog').filter({ hasText: '自分を編集者にする' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: '編集者にする', exact: true }).click()
      await expect(inviteePage).toHaveURL(/\/_admin\/?$/)
      const nav = inviteePage.getByRole('navigation', { name: '管理メニュー', exact: true })
      await expect(nav.getByRole('link', { name: '固定ページ', exact: true })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'ユーザー', exact: true })).toHaveCount(0)
    } finally {
      await invitee.close()
    }

    await page.reload()
    await expect(page.getByLabel(`${name} の権限`, { exact: true })).toHaveValue('editor')
  })

  test('stores smaller copies of an uploaded image and serves them with srcset', async ({
    browser,
    page,
  }) => {
    const suffix = uniqueSuffix()
    const filename = `${E2E_PREFIX}photo-${suffix}.png`

    await page.goto('/_admin/media')
    await page.locator('input[type="file"]').waitFor({ state: 'attached' })
    // A real 1200x600 picture, drawn in the page and handed to the upload input.
    await page.evaluate(async (name) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 600
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no canvas')
      const gradient = context.createLinearGradient(0, 0, 1200, 600)
      gradient.addColorStop(0, '#2f6f5e')
      gradient.addColorStop(1, '#f4d58d')
      context.fillStyle = gradient
      context.fillRect(0, 0, 1200, 600)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('no blob')
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], name, { type: 'image/png' }))
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')
      if (!input) throw new Error('no upload input')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, filename)

    const card = page.locator('article').filter({ hasText: filename })
    await expect(card).toContainText('1200×600', { timeout: 20_000 })
    await expect(card).toContainText('縮小版 2 種', { timeout: 20_000 })
    await expect(card.getByRole('button', { name: '削除' })).toBeHidden()
    const more = card.getByRole('button', { name: `${filename} のその他の操作` })
    await more.click()
    await expect(card.getByRole('button', { name: '削除' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'URL コピー' })).toBeVisible()
    await card.getByRole('button', { name: 'alt 編集' }).press('Escape')
    await expect(more).toBeFocused()
    await expect(card.getByRole('button', { name: '削除' })).toBeHidden()

    const listed = (await (
      await apiRequest.get('/api/v1/media', { params: { q: filename } })
    ).json()) as MediaList
    const media = listed.items[0]
    expect(media?.variants.map((variant) => variant.width)).toEqual([480, 960])
    const variant = await apiRequest.get(media?.variants[1]?.url ?? '')
    expect(variant.status()).toBe(200)
    expect(variant.headers()['content-type']).toBe('image/webp')

    const slug = `${E2E_PREFIX}image-${suffix}`
    await createPage({
      title: `E2E Image ${suffix}`,
      slug,
      status: 'published',
      bodyJson: body('with a picture', media?.url),
    })
    // The same picture in the body of a post.
    const typeSlug = `${E2E_PREFIX}news-${suffix}`
    const typeResponse = await apiRequest.post('/api/v1/post-types', {
      data: { slug: typeSlug, name: `E2E News ${suffix}` },
    })
    expect(typeResponse.status(), await typeResponse.text()).toBe(201)
    const type = ((await typeResponse.json()) as { item: { id: number } }).item
    const postResponse = await apiRequest.post('/api/v1/posts', {
      data: {
        postTypeId: type.id,
        slug: `${E2E_PREFIX}post-${suffix}`,
        title: `E2E Post ${suffix}`,
        status: 'published',
        bodyJson: body('a post with a picture', media?.url),
      },
    })
    expect(postResponse.status(), await postResponse.text()).toBe(201)

    const visitor = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })
    try {
      const visitorPage = await visitor.newPage()
      for (const [path, selector] of [
        [`/${slug}`, 'article.page img'],
        [`/${typeSlug}/${E2E_PREFIX}post-${suffix}`, '.post-body img'],
      ] as const) {
        await visitorPage.goto(path)
        const image = visitorPage.locator(selector)
        await expect(image).toHaveAttribute(
          'srcset',
          /\.w480\.webp 480w, .*\.w960\.webp 960w, .*\.png 1200w/,
        )
        await expect(image).toHaveAttribute('width', '1200')
        await expect(image).toHaveAttribute('height', '600')
        // The browser really loads a variant, not the original.
        await expect
          .poll(() => image.evaluate((element: HTMLImageElement) => element.currentSrc))
          .toMatch(/\.w(480|960)\.webp$/)
        expect(
          await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
        ).toBeGreaterThan(0)
        // A 1200px picture in a narrower text column: scaled to fit, proportions kept.
        const box = await image.evaluate((element: HTMLImageElement) => {
          const rect = element.getBoundingClientRect()
          const column = element.parentElement?.getBoundingClientRect().width ?? 0
          return { width: rect.width, height: rect.height, column }
        })
        expect(box.column, path).toBeLessThan(1200)
        expect(box.width, path).toBeLessThanOrEqual(box.column + 0.5)
        expect(box.width / box.height, path).toBeCloseTo(2, 1)
      }
    } finally {
      await visitor.close()
    }
  })
})
