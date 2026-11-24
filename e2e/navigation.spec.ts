import { expect, type Locator, type Page, test } from '@playwright/test'

const user = {
  id: 1,
  name: '編集担当者',
  email: 'navigation@example.com',
  role: 'admin',
}

// Exercise the real admin bundle without changing local content or authentication.
async function mockAdmin(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const responses: Record<string, unknown> = {
      '/api/v1/auth/me': { principal: { kind: 'session', user } },
      '/api/v1/health': { ok: true, site: 'kansoCMS' },
      '/api/v1/starter': { installed: false },
      '/api/v1/pages': {
        items: [
          {
            id: 1,
            parentId: null,
            sortOrder: 0,
            title: 'サンプルページ',
            path: 'sample',
            status: 'published',
            publishedAt: null,
            updatedAt: null,
          },
        ],
        total: 1,
      },
      '/api/v1/auth/passkeys': { items: [] },
      '/api/v1/auth/profile': { profile: { slug: null, bio: null, avatarMediaId: null } },
    }
    if (path in responses) await route.fulfill({ json: responses[path] })
    else await route.fulfill({ status: 404, json: { error: { code: 'not_found', message: path } } })
  })
}

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  if (!value) throw new Error('The element has no layout box.')
  return value
}

test.beforeEach(async ({ page }) => {
  await mockAdmin(page)
})

test('desktop sidebar collapses, keeps navigation usable, and remembers the choice', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/')
  const sidebar = page.getByRole('complementary', { name: 'サイドバー' })
  const nav = page.getByRole('navigation', { name: '管理メニュー', exact: true })
  await expect(sidebar).toHaveCSS('width', '240px')
  await page.screenshot({ path: testInfo.outputPath('desktop-expanded.png') })

  // The logo sits right of the sidebar toggle in the header, and the navigation starts the sidebar.
  const collapse = page.getByRole('button', { name: 'サイドバーを折りたたむ' })
  const toggle = await box(collapse)
  const logo = page.getByRole('banner').getByRole('link', { name: 'kansoCMS ダッシュボード' })
  expect((await box(logo)).x).toBeGreaterThan(toggle.x + toggle.width)
  const dashboard = nav.getByRole('link', { name: 'ダッシュボード', exact: true })
  expect((await box(dashboard)).y - (await box(sidebar)).y).toBeLessThanOrEqual(12)

  // The navigation's scrollbar shows only while the pointer is over it.
  const hiddenThumb = /^rgba\(0, 0, 0, 0\) /
  await page.mouse.move(800, 400)
  await expect(nav).toHaveCSS('scrollbar-color', hiddenThumb)
  await nav.hover()
  await expect(nav).not.toHaveCSS('scrollbar-color', hiddenThumb)

  await collapse.click()
  const expand = page.getByRole('button', { name: 'サイドバーを展開' })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expect(sidebar).toHaveCSS('width', '72px')
  // The toggle stays where it was, so a second click undoes the first.
  expect((await box(expand)).x).toBe(toggle.x)
  const pages = nav.getByRole('link', { name: '固定ページ', exact: true })
  await expect(pages).toHaveAttribute('title', '固定ページ')
  await pages.click()
  await expect(page).toHaveURL(/\/admin\/pages\/?$/)
  await expect(pages).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'ダッシュボード' })).not.toHaveAttribute(
    'aria-current',
  )
  await page.reload()
  await expect(sidebar).toHaveCSS('width', '72px')
  await page.screenshot({ path: testInfo.outputPath('desktop-collapsed.png') })

  await expand.click()
  await page.reload()
  await expect(sidebar).toHaveCSS('width', '240px')
  const account = nav.getByRole('link', { name: 'アカウント', exact: true })
  await account.scrollIntoViewIfNeeded()
  await expect(account).toBeInViewport()
})

test('sidebar remains usable when local storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('Storage blocked', 'SecurityError')
      },
    })
  })
  await page.goto('/admin/')
  await page.getByRole('button', { name: 'サイドバーを折りたたむ' }).click()
  await expect(page.getByRole('button', { name: 'サイドバーを展開' })).toBeVisible()
  await page.getByRole('button', { name: 'サイドバーを展開' }).click()
  await expect(page.getByRole('button', { name: 'サイドバーを折りたたむ' })).toBeVisible()
})

test('mobile drawer contains focus, scrolls, and restores focus on each dismissal path', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.goto('/admin/')
  const trigger = page.getByRole('button', { name: 'メニューを開く' })
  const drawer = page.getByRole('dialog', { name: '管理メニュー', exact: true })
  const close = drawer.getByRole('button', { name: 'メニューを閉じる' })
  await expect(drawer).not.toBeVisible()
  await expect(
    page.getByRole('navigation', { name: '管理メニュー', exact: true }),
  ).not.toBeVisible()
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(close).toBeFocused()
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden')
  await page.screenshot({ path: testInfo.outputPath('mobile-drawer.png'), animations: 'disabled' })

  await page.keyboard.press('Tab')
  await expect(drawer.getByRole('link', { name: 'kansoCMS', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(drawer.getByRole('link', { name: 'ダッシュボード', exact: true })).toBeFocused()
  const account = drawer.getByRole('link', { name: 'アカウント', exact: true })
  await account.focus()
  await expect(account).toBeFocused()
  await expect(account).toBeInViewport()
  await page.keyboard.press('Tab')
  // Native dialogs may briefly move focus to browser chrome (document.body).
  expect(
    await drawer.evaluate(
      (element) =>
        document.activeElement === document.body || element.contains(document.activeElement),
    ),
  ).toBe(true)
  if (await page.evaluate(() => document.activeElement === document.body)) {
    await page.keyboard.press('Tab')
  }
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')

  await trigger.click()
  await page.mouse.click(380, 300)
  await expect(drawer).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await close.click()
  await expect(drawer).not.toBeVisible()
  await expect(trigger).toBeFocused()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await trigger.click()
  await expect(drawer.locator('.admin-drawer-sheet')).toHaveCSS('animation-name', 'none')
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
})

test('mobile navigation closes on route changes, current-page links, and browser back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/admin/')
  const trigger = page.getByRole('button', { name: 'メニューを開く' })
  const drawer = page.getByRole('dialog', { name: '管理メニュー', exact: true })
  await trigger.click()
  await drawer.getByRole('link', { name: '固定ページ', exact: true }).click()
  await expect(page.getByRole('heading', { name: '固定ページ', exact: true })).toBeVisible()
  await expect(drawer).not.toBeVisible()

  await trigger.click()
  await drawer.getByRole('link', { name: '固定ページ', exact: true }).click()
  await expect(drawer).not.toBeVisible()
  await trigger.click()
  await page.goBack()
  await expect(drawer).not.toBeVisible()
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
})

test('resizing closes the modal and preserves the desktop preference', async ({ page }) => {
  await page.goto('/admin/')
  await page.getByRole('button', { name: 'サイドバーを折りたたむ' }).click()
  await page.setViewportSize({ width: 768, height: 700 })
  const trigger = page.getByRole('button', { name: 'メニューを開く' })
  const drawer = page.getByRole('dialog', { name: '管理メニュー', exact: true })
  await trigger.click()
  await expect(drawer.getByRole('link', { name: '固定ページ', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 700 })
  await expect(drawer).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'サイドバーを展開' })).toBeFocused()
  await expect(page.getByRole('complementary', { name: 'サイドバー' })).toHaveCSS('width', '72px')
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
  await page.setViewportSize({ width: 375, height: 667 })
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(drawer).toBeVisible()
})

test('editor navigation keeps administrator-only destinations hidden in both layouts', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { principal: { kind: 'session', user: { ...user, role: 'editor' } } } }),
  )
  await page.goto('/admin/')
  await page.getByRole('button', { name: 'サイドバーを折りたたむ' }).click()
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 })
    if (width === 390) await page.getByRole('button', { name: 'メニューを開く' }).click()
    const nav = page.getByRole('navigation', {
      name: width === 390 ? 'モバイル管理メニュー' : '管理メニュー',
      exact: true,
    })
    await expect(nav.getByRole('link', { name: '固定ページ', exact: true })).toBeVisible()
    for (const name of ['設定', 'ユーザー', 'API キー']) {
      await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0)
    }
  }
})

test('page controls fit small screens while the table scrolls within its container', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: { principal: { kind: 'session', user: { ...user, name: user.name.repeat(20) } } },
    }),
  )
  await page.goto('/admin/pages')
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(page.getByRole('heading', { name: '固定ページ', exact: true })).toBeVisible()
    const metrics = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(metrics.pageWidth, `${width}px viewport`).toBeLessThanOrEqual(metrics.viewport)
    for (const control of [
      page.getByRole('textbox', { name: '固定ページを検索' }),
      page.getByRole('combobox', { name: '状態' }),
      page.getByRole('button', { name: '検索', exact: true }),
    ]) {
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box?.width).toBeGreaterThan(40)
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
    }
    if (width === 320) {
      const table = page.getByRole('table').locator('..')
      expect(await table.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
        await table.evaluate((element) => element.clientWidth),
      )
      await table.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      expect(await table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
      await table.evaluate((element) => {
        element.scrollLeft = 0
      })
      await page.screenshot({ path: testInfo.outputPath('mobile-page-list.png') })
    }
  }
})
