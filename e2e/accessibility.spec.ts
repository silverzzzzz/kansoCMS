import AxeBuilder from '@axe-core/playwright'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import {
  apiLogin,
  cleanupE2E,
  E2E_PREFIX,
  ensureAdmin,
  shareSession,
  uniqueSuffix,
} from './helpers.ts'

type Created = { item: { id: number; slug: string } }

/**
 * Automated accessibility checks (axe-core) on the public site and the main
 * admin screens. WCAG 2.1 A/AA rules; serious and critical findings fail the
 * test. Automated checks find only part of the problems: this guards against
 * regressions, it does not certify the UI.
 */
type Finding = { path: string; rule: string; impact: string; help: string; targets: string[] }

async function seriousViolations(page: Page, path: string): Promise<Finding[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // The customize preview is a sandboxed srcdoc frame without scripts: axe waits forever
    // for its frame script there. Excluded frames are not entered. The frame shows a
    // public page, and public pages are checked on their own.
    .exclude('iframe[title="プレビュー"]')
    .analyze()
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      path,
      rule: violation.id,
      impact: violation.impact ?? '',
      help: violation.help,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    }))
}

/** Every path is checked before failing, so one run lists all the findings. */
function expectNone(findings: Finding[]) {
  expect(findings, JSON.stringify(findings, null, 2)).toEqual([])
}

test.describe('accessibility', () => {
  let apiRequest: APIRequestContext
  let pagePath = ''
  let postPath = ''
  let pageId = 0

  test.beforeAll(async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Playwright baseURL is not configured')
    apiRequest = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { origin: baseURL },
    })
    await ensureAdmin(apiRequest)
    await apiLogin(apiRequest)
    await cleanupE2E(apiRequest)

    const suffix = uniqueSuffix()
    const body = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'アクセシビリティ検査用の本文です。' }],
        },
      ],
    }
    const page = await apiRequest.post('/api/v1/pages', {
      data: {
        title: '検査用ページ',
        slug: `${E2E_PREFIX}a11y-${suffix}`,
        status: 'published',
        bodyJson: body,
      },
    })
    expect(page.status(), await page.text()).toBe(201)
    const createdPage = ((await page.json()) as Created).item
    pagePath = `/${createdPage.slug}`
    pageId = createdPage.id

    const type = await apiRequest.post('/api/v1/post-types', {
      // Pages and post types share the top-level URL space, so the slug differs from the page's.
      data: { slug: `${E2E_PREFIX}a11y-news-${suffix}`, name: '検査用の投稿' },
    })
    expect(type.status(), await type.text()).toBe(201)
    const typeSlug = ((await type.json()) as Created).item.slug
    const post = await apiRequest.post('/api/v1/posts', {
      data: {
        postTypeId: ((await type.json()) as Created).item.id,
        title: '検査用の投稿',
        slug: 'hello',
        status: 'published',
        bodyJson: body,
      },
    })
    expect(post.status(), await post.text()).toBe(201)
    postPath = `/${typeSlug}/hello`
  })

  test.afterAll(async () => {
    try {
      await cleanupE2E(apiRequest)
    } finally {
      await apiRequest?.dispose()
    }
  })

  test('public pages', async ({ page }) => {
    const findings: Finding[] = []
    for (const path of [pagePath, postPath, '/search?q=検査', '/no-such-page-a11y']) {
      await page.goto(path)
      findings.push(...(await seriousViolations(page, path)))
    }
    expectNone(findings)
  })

  test('admin sign-in screen', async ({ page }) => {
    await page.goto('/_admin/login')
    await expect(page.getByRole('button', { name: /パスキー/ })).toBeVisible()
    expectNone(await seriousViolations(page, '/_admin/login'))
  })

  test('admin screens', async ({ page }) => {
    // About 20 screens at a few seconds each (load, network idle, axe).
    test.setTimeout(180_000)
    await shareSession(page.context(), apiRequest)
    const findings: Finding[] = []
    for (const path of [
      '/_admin/',
      '/_admin/activity',
      '/_admin/analytics',
      '/_admin/pages',
      `/_admin/pages/${pageId}`,
      '/_admin/customize',
      '/_admin/menus',
      '/_admin/posts',
      '/_admin/posts?trashed=true',
      '/_admin/posts/new',
      '/_admin/post-types',
      '/_admin/tags',
      '/_admin/media',
      '/_admin/forms',
      '/_admin/redirects',
      '/_admin/tools',
      '/_admin/settings',
      '/_admin/users',
      '/_admin/api-keys',
      '/_admin/account',
    ]) {
      await page.goto(path)
      await expect(page.locator('main')).toBeVisible()
      await page.waitForLoadState('networkidle')
      findings.push(...(await seriousViolations(page, path)))
    }
    expectNone(findings)
  })
})
