import { expect } from '@playwright/test'
import { test } from './editor-fixtures.ts'
import { uniqueSuffix } from './helpers.ts'

for (const [device, width, height] of [
  ['PC', 1280, 800],
  ['スマホ', 390, 844],
] as const) {
  test(`${device} 幅で長文の先頭に本文、末尾に保存と書式操作が見える`, async ({ page, api }) => {
    await page.setViewportSize({ width, height })
    const type = await api.post('/api/v1/post-types', {
      data: { name: '計測用', slug: `e2e-layout-type-${uniqueSuffix()}` },
    })
    expect(type.status()).toBe(201)
    const response = await api.post('/api/v1/posts', {
      data: {
        postTypeId: (await type.json()).item.id,
        title: '長文',
        slug: `e2e-layout-${uniqueSuffix()}`,
        bodyJson: {
          type: 'doc',
          content: Array.from({ length: 40 }, (_, i) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: `段落 ${i + 1}` }],
          })),
        },
      },
    })
    expect(response.status()).toBe(201)
    const { item } = await response.json()
    await page.goto(`/_admin/posts/${item.id}`)
    const editor = page.locator('.ProseMirror')
    await expect(editor.locator('p').first()).toBeInViewport()
    await editor.locator('p').last().scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport()
    await expect(page.getByRole('toolbar').first()).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
  })
}

test('下書きの復元、ショートカット保存、スラッグ重複からの再試行', async ({ page, api }) => {
  const slug = `e2e-edit-${uniqueSuffix()}`
  expect((await api.post('/api/v1/pages', { data: { title: '既存ページ', slug } })).status()).toBe(
    201,
  )
  await page.goto('/_admin/pages/new')
  const title = page.getByLabel('タイトル', { exact: true })
  const slugInput = page.getByLabel('スラッグ', { exact: true })
  const body = page.locator('.ProseMirror')
  await expect(title).toBeFocused()
  await title.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 })
  await expect(title).toBeFocused()
  await title.press('Enter')
  await expect(body).toBeFocused()
  await expect(page.getByText('未保存の変更があります', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'kansoCMS ダッシュボード' }).click()
  await expect(page).toHaveURL(/\/_admin\/?$/)
  await page.goto('/_admin/pages/new')
  await title.fill('春のお知らせ')
  await expect(slugInput).toHaveValue(/^page-[0-9a-f]{8}$/)
  await slugInput.fill(slug)
  await body.fill('書きかけの本文')
  const leave = page.getByRole('link', { name: 'kansoCMS ダッシュボード' })
  page.once('dialog', (dialog) => dialog.dismiss())
  await leave.click()
  await expect(title).toHaveValue('春のお知らせ')
  page.once('dialog', (dialog) => dialog.accept())
  await leave.click()
  await expect(page).toHaveURL(/\/_admin\/?$/)
  await page.goto('/_admin/pages/new')
  await page.getByRole('button', { name: '下書きを復元' }).click()
  await expect(body).toHaveText('書きかけの本文')
  await expect(title).toHaveValue('春のお知らせ')
  await title.press('Control+s')
  await expect(slugInput).toBeFocused()
  await expect(slugInput).toHaveAttribute('aria-invalid', 'true')
  await expect(slugInput).toHaveAccessibleDescription(/別のスラッグ/)
  await expect(slugInput).toBeInViewport()
  await slugInput.fill(`${slug}-2`)
  await slugInput.press('Meta+s')
  await expect(page).toHaveURL(/\/_admin\/pages\/\d+\/?$/)
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
  const revisions = async () =>
    (await (await api.get(`/api/v1/pages/${id}/revisions`)).json()).items.length
  const before = await revisions()
  await title.fill('追記したお知らせ')
  page.once('dialog', (dialog) => dialog.accept())
  await page.reload()
  await expect(title).toHaveValue('春のお知らせ')
  await page.getByRole('button', { name: '下書きを復元' }).click()
  await expect(title).toHaveValue('追記したお知らせ')
  expect(await revisions()).toBe(before)
  await title.press('Control+s')
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  expect(await revisions()).toBe(before + 1)
  await page.reload()
  await expect(title).toHaveValue('追記したお知らせ')
  await expect(page.getByRole('button', { name: '下書きを復元' })).toHaveCount(0)
})

test('保存中に書き足した内容と別の画面からの更新を保護する', async ({ page, api }) => {
  const created = await api.post('/api/v1/pages', {
    data: { title: '初稿', slug: `e2e-race-${uniqueSuffix()}` },
  })
  expect(created.status()).toBe(201)
  const { item } = await created.json()
  const path = `/api/v1/pages/${item.id}`
  await page.goto(`/_admin/pages/${item.id}`)
  const title = page.getByLabel('タイトル', { exact: true })
  let resume = () => {}
  const release = new Promise<void>((resolve) => {
    resume = resolve
  })
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === 'PATCH') await release
    await route.continue()
  })
  try {
    await title.fill('送信した初稿')
    await title.press('Control+s')
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    await title.fill('通信中の追記')
  } finally {
    resume()
  }
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
  await expect(title).toHaveValue('通信中の追記')
  await expect(page.getByText('未保存の変更があります', { exact: true })).toBeVisible()
  const saved = (await (await api.get(path)).json()).item
  expect(saved.title).toBe('送信した初稿')
  // The existing API compares versions at the database's one-second precision.
  await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(Date.parse(saved.updatedAt) + 1000)
  expect((await api.patch(path, { data: { title: '別の編集者が保存' } })).ok()).toBe(true)
  await title.press('Control+s')
  await expect(page.getByRole('button', { name: 'このまま上書き保存' })).toBeVisible()
  expect((await (await api.get(path)).json()).item.title).toBe('別の編集者が保存')
  await expect(title).toHaveValue('通信中の追記')
  await page.getByRole('button', { name: 'このまま上書き保存' }).click()
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  expect((await (await api.get(path)).json()).item.title).toBe('通信中の追記')
})

test('投稿で日本語のタグを変換確定してからスラッグを入力できる', async ({ page, api }) => {
  const suffix = uniqueSuffix()
  const typeSlug = `e2e-post-type-${suffix}`
  expect(
    (
      await api.post('/api/v1/post-types', {
        data: { slug: typeSlug, name: 'お知らせ', hasTags: true },
      })
    ).status(),
  ).toBe(201)
  const tagSlug = `e2e-tag-${suffix}`
  let tagId: number | undefined
  try {
    await page.goto(`/_admin/posts/new?type=${typeSlug}`)
    const title = page.getByLabel('タイトル', { exact: true })
    await expect(title).toBeFocused()
    await title.press('Enter')
    await expect(page.getByRole('textbox', { name: '本文', exact: true })).toBeFocused()
    await expect(page.getByText('未保存の変更があります', { exact: true })).toHaveCount(0)
    await title.fill('季節のお知らせ')
    await expect(page.getByLabel('スラッグ', { exact: true })).toHaveValue(/^post-[0-9a-f]{8}$/)
    const tag = page.getByLabel('タグ', { exact: true })
    await tag.fill('春の草花')
    await tag.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 })
    const slug = page.getByLabel('「春の草花」のスラッグ', { exact: true })
    await expect(slug).toHaveCount(0)
    await tag.press('Enter')
    await expect(slug).toBeFocused()
    await slug.fill(tagSlug)
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/tags') && r.request().method() === 'POST',
    )
    await slug.press('Enter')
    const response = await created
    expect(response.status()).toBe(201)
    tagId = (await response.json()).item.id
    await expect(slug).toHaveCount(0)
    await title.press('Control+s')
    await expect(page).toHaveURL(/\/_admin\/posts\/\d+\/?$/)
    const id = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
    const post = (await (await api.get(`/api/v1/posts/${id}`)).json()).item
    expect(post.tagIds).toContain(tagId)
  } finally {
    if (tagId !== undefined) await api.delete(`/api/v1/tags/${tagId}`)
  }
})

test('複数の設定を変更しても入力中のフォームだけ保存する', async ({ page, api }) => {
  const initial = await (await api.get('/api/v1/settings')).json()
  const orgName = `事務局 ${uniqueSuffix()}`
  try {
    await page.goto('/_admin/settings')
    await page.getByLabel('サイト名', { exact: true }).fill('未保存のサイト名')
    const organization = page.getByLabel('組織名', { exact: true })
    await organization.fill(orgName)
    await organization.press('Control+s')
    await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
    const settings = await (await api.get('/api/v1/settings')).json()
    expect(settings.organization.name).toBe(orgName)
    expect(settings.site.title).toBe(initial.site.title)
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: 'ログアウト' }).click()
    await expect(page).toHaveURL(/\/_admin\/settings\/?$/)
    await expect(page.getByLabel('サイト名', { exact: true })).toHaveValue('未保存のサイト名')
  } finally {
    expect(
      (await api.put('/api/v1/settings/organization', { data: initial.organization })).ok(),
    ).toBe(true)
  }
})
