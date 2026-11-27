import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test'
import type { RichTextDoc } from '../packages/shared/src/richtext.ts'
import { test } from './editor-fixtures.ts'
import { uniqueSuffix } from './helpers.ts'

async function editPage(page: Page, request: APIRequestContext, bodyJson: RichTextDoc) {
  const response = await request.post('/api/v1/pages', {
    data: {
      title: 'エディターの確認',
      slug: `e2e-editor-${uniqueSuffix()}`,
      status: 'draft',
      bodyJson,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  const { item } = await response.json()
  await page.goto(`/_admin/pages/${item.id}`)
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).toBeVisible()
  return item.id as number
}

test('長文の末尾でもツールバーを使え、カーソル位置の書式が反映される', async ({
  page,
  api: request,
}) => {
  await editPage(page, request, {
    type: 'doc',
    content: Array.from({ length: 40 }, (_, i) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `段落 ${i + 1}`, marks: i === 39 ? [{ type: 'bold' }] : [] }],
    })),
  })
  const body = page.getByRole('textbox', { name: '本文', exact: true })
  const toolbar = page.getByRole('toolbar', { name: '本文の編集' })
  const bold = toolbar.getByRole('button', { name: '太字', exact: true })
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height })
    await body.locator('p').last().click()
    await expect(bold).toHaveAttribute('aria-pressed', 'true')
    await expect(toolbar.locator('button').first()).toBeInViewport()
    await expect(toolbar.getByRole('button', { name: 'やり直す' })).toBeInViewport()
    expect(await toolbar.evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true)
    if (width === 1280) {
      const first = await bold.boundingBox()
      const last = await toolbar.getByRole('button', { name: 'やり直す' }).boundingBox()
      expect(last?.y).toBe(first?.y)
    }
    expect(
      await toolbar.evaluate((element) => {
        const { left, top, height } = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(left + 6, top + height / 2))
      }),
    ).toBe(true)
    await body.press('Control+Home')
    await expect(bold).toHaveAttribute('aria-pressed', 'false')
    await body.locator('p').last().click()
    await body.press('End')
    await body.press('Enter')
    await page.keyboard.insertText('／ｈ２')
    const menu = page.getByRole('listbox', { name: '本文への挿入' })
    await expect(menu.getByRole('option', { name: '見出し 2' })).toBeVisible()
    await expectCaretPanel(menu, body.locator('p').last(), width)
    await body.press('Escape')
    await expect(menu).toBeHidden()
    await body.press('Home')
    await body.press('Shift+End')
    await body.press('Control+k')
    const panel = page.getByRole('group', { name: 'リンクの編集' })
    await expect(panel.getByRole('textbox')).toBeFocused()
    await expectCaretPanel(panel, body.locator('.editor-link-selection'), width)
    await panel.getByRole('textbox').press('Escape')
    await body.press('Backspace')
    await body.press('Backspace')
  }
})

async function expectCaretPanel(panel: Locator, line: Locator, width: number) {
  await expect
    .poll(async () => {
      const [box, text] = await Promise.all([panel.boundingBox(), line.boundingBox()])
      if (!box || !text) return false
      const gap = Math.min(
        Math.abs(box.y - text.y - text.height),
        Math.abs(text.y - box.y - box.height),
      )
      return gap < 20 && box.x >= 0 && box.x + box.width <= width
    })
    .toBe(true)
}

test('選択中のリンク編集とスラッシュ挿入は本文と選択を保つ', async ({ page, api: request }) => {
  const id = await editPage(page, request, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '説明を読む' }] }],
  })
  const body = page.getByRole('textbox', { name: '本文', exact: true })
  await body.click()
  await body.press('Home')
  await body.press('Shift+End')
  const bubble = page.getByRole('group', { name: '選択した文字の書式' })
  await bubble.getByRole('button', { name: 'リンク', exact: true }).click()
  const url = page.getByRole('textbox', { name: 'リンク先 URL' })
  await url.fill('未入力の形式')
  await url.press('Enter')
  await expect(url).toHaveAttribute('aria-invalid', 'true')
  await url.fill('/about')
  await url.press('Enter')
  await expect(body.locator('a')).toHaveText('説明を読む')
  await expect(body.locator('a')).toHaveAttribute('href', '/about')
  await expect(body.locator('a')).not.toHaveAttribute('target')
  await expect(body.locator('a')).not.toHaveAttribute('rel', /nofollow/)
  await expect(body.locator('a')).toHaveCSS('text-decoration-line', 'underline')

  await body.press('Control+End')
  await body.press('Enter')
  const menu = page.getByRole('listbox', { name: '本文への挿入' })
  await page.keyboard.type('/image')
  await menu.getByRole('option', { name: '画像' }).click()
  const picker = page.getByRole('dialog')
  await expect(picker.getByRole('heading', { name: 'メディアを選択' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(body).toBeFocused()
  await expect(body).toContainText('/image')
  await body.press('Home')
  await body.press('Shift+End')
  await page.keyboard.type('/h2')
  await expect(menu.getByRole('option', { name: '見出し 2' })).toBeVisible()
  await body.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 })
  await expect(menu).toBeVisible()
  await expect(body).toContainText('/h2')
  await body.press('Enter')
  await page.keyboard.insertText('新しい見出し')
  await expect(body.locator('h2')).toHaveText('新しい見出し')
  await body.press('Enter')
  await page.keyboard.type('/html')
  await menu.getByRole('option', { name: 'HTML ブロック' }).click()
  await body.getByText('HTML ブロックを編集').click()
  await body.getByLabel('HTML ソース').fill('<p>追記</p>')
  const save = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/pages/${id}`) && response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect((await save).ok()).toBe(true)
  await page.reload()
  await expect(body.locator('h2')).toHaveText('新しい見出し')
  await body.getByText('HTML ブロックを編集').click()
  await expect(body.getByLabel('HTML ソース')).toHaveValue('<p>追記</p>')
})

test('既存リンクの属性を引き継ぎ、新しいリンクの開き方を公開ページに反映する', async ({
  page,
  api,
}) => {
  const id = await editPage(page, api, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '旧リンク',
            marks: [
              {
                type: 'link',
                attrs: { href: '/old', target: '_blank', rel: 'nofollow', title: '以前の注釈' },
              },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: '新しいリンク' }] },
    ],
  })
  const body = page.getByRole('textbox', { name: '本文', exact: true })
  const url = page.getByRole('textbox', { name: 'リンク先 URL' })
  const newTab = page.getByLabel('新しいタブで開く')
  await body.locator('a').click()
  await body.press('Meta+k')
  await expect(newTab).toBeChecked()
  await url.fill('/updated')
  await url.press('Enter')
  await body.locator('p').last().click()
  await body.press('Home')
  await body.press('Shift+End')
  await body.press('Control+k')
  await expect(newTab).not.toBeChecked()
  await url.fill('example.com/guide')
  await page.getByText('新しいタブで開く', { exact: true }).click()
  await expect(newTab).toBeChecked()
  await page.getByRole('button', { name: '適用', exact: true }).click()
  await body.press('Control+End')
  await body.press('Enter')
  await body.press('Control+k')
  await url.fill('/about')
  await url.press('Enter')
  await page.getByLabel('状態', { exact: true }).selectOption('published')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  const { item } = await (await api.get(`/api/v1/pages/${id}`)).json()
  await page.goto(`/${item.path}`)
  const old = page.getByRole('link', { name: '旧リンク' })
  await expect(old).toHaveAttribute('href', '/updated')
  await expect(old).toHaveAttribute('target', '_blank')
  await expect(old).toHaveAttribute('rel', /nofollow/)
  await expect(old).toHaveAttribute('title', '以前の注釈')
  const external = page.getByRole('link', { name: '新しいリンク' })
  await expect(external).toHaveAttribute('href', 'https://example.com/guide')
  await expect(external).toHaveAttribute('target', '_blank')
  await expect(external).toHaveAttribute('rel', /noopener/)
  await expect(external).not.toHaveAttribute('rel', /nofollow/)
  const internal = page.getByRole('link', { name: '/about', exact: true })
  await expect(internal).toHaveAttribute('href', '/about')
  await expect(internal).not.toHaveAttribute('target')
  await expect(internal).not.toHaveAttribute('rel', /nofollow/)
})

// A real PNG uploaded through the same API as the media library.
async function transferImage(body: Locator, operation: 'paste' | 'drop', name: string) {
  await body.evaluate(
    (element, { operation, name }) => {
      const bytes = Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        ),
        (char) => char.charCodeAt(0),
      )
      const data = new DataTransfer()
      data.items.add(new File([bytes], name, { type: 'image/png' }))
      const bounds = element.getBoundingClientRect()
      const event =
        operation === 'paste'
          ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
          : new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              dataTransfer: data,
              clientX: bounds.left + 20,
              clientY: bounds.top + 22,
            })
      element.dispatchEvent(event)
    },
    { operation, name },
  )
}

test('貼り付けとドロップで画像を挿入し、代替テキストを保存できる', async ({
  page,
  api: request,
}) => {
  const id = await editPage(page, request, {
    type: 'doc',
    content: ['最初', '置き換える文字', '最後'].map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  })
  const body = page.getByRole('textbox', { name: '本文', exact: true })
  await body.locator('p').nth(1).click()
  await body.press('Home')
  await body.press('Shift+End')
  // Hold the real request while the author continues in a different paragraph.
  // The completed paste should still replace the original selection.
  let releaseUpload = () => {}
  const gate = new Promise<void>((resolve) => {
    releaseUpload = resolve
  })
  await page.route('**/api/v1/media', async (route) => {
    if (route.request().method() === 'POST') await gate
    await route.continue()
  })
  try {
    await transferImage(body, 'paste', 'e2e-editor-paste.png')
    await expect(body.getByText('画像をアップロード中…')).toBeVisible()
    await body.locator('p').last().click()
    await body.press('End')
    await page.keyboard.insertText('に追記')
  } finally {
    releaseUpload()
  }
  await expect(body.locator('img')).toHaveCount(1)
  await expect(body).not.toContainText('置き換える文字')
  await expect(body.locator('p').last()).toHaveText('最後に追記')
  await body.getByText('代替テキストを編集').click()
  await body.getByLabel('代替テキスト', { exact: true }).fill('白い花')
  await expect(body.getByRole('img', { name: '白い花' })).toBeVisible()
  await transferImage(body, 'drop', 'e2e-editor-drop.png')
  await expect(body.locator('img')).toHaveCount(2)
  await page.getByRole('combobox', { name: '挿入', exact: true }).selectOption('image')
  const picker = page.getByRole('dialog', { name: 'メディアを選択' })
  const card = picker.locator('article').filter({ hasText: 'e2e-editor-drop.png' }).first()
  await expect(card.getByRole('button', { name: '選択', exact: true })).toBeVisible()
  await expect(
    picker.getByRole('button', { name: /削除|URL コピー|alt 編集|その他の操作|縮小版を作成/ }),
  ).toHaveCount(0)
  await picker.getByRole('textbox', { name: 'メディアを検索' }).fill('e2e-editor-drop')
  await picker.getByRole('button', { name: '検索', exact: true }).click()
  await expect(picker.locator('article').filter({ hasText: 'e2e-editor-paste.png' })).toHaveCount(0)
  await picker.getByRole('button', { name: '閉じる' }).click()
  await expect(page.getByText('未保存の変更があります', { exact: true })).toBeVisible()
  const save = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/pages/${id}`) && response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect((await save).ok()).toBe(true)
  const { item } = await (await request.get(`/api/v1/pages/${id}`)).json()
  const images = (item.bodyJson as RichTextDoc).content.filter((node) => node.type === 'image')
  expect(images).toHaveLength(2)
  expect(images.map((image) => image.attrs.alt)).toContain('白い花')
})
