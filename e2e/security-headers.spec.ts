import { type APIRequestContext, expect, test } from '@playwright/test'
import { apiLogin, ensureAdmin, shareSession } from './helpers.ts'

declare global {
  interface Window {
    __cspViolations: string[]
  }
}

/**
 * The admin runs under a Content-Security-Policy without inline script or eval
 * (apps/server/src/security-headers.ts). Each route is loaded directly, so the
 * document comes from the Worker's SPA fallback with the policy, and any
 * violation it causes (including caught ones, which the console never shows)
 * fails the test.
 */
test.describe('admin content security policy', () => {
  let apiRequest: APIRequestContext

  test.beforeAll(async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Playwright baseURL is not configured')
    apiRequest = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { origin: baseURL },
    })
    await ensureAdmin(apiRequest)
    await apiLogin(apiRequest)
  })

  test.afterAll(async () => {
    await apiRequest?.dispose()
  })

  test('raises no violations on the main screens', async ({ page }) => {
    await shareSession(page.context(), apiRequest)
    await page.addInitScript(() => {
      window.__cspViolations = []
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`)
      })
    })

    for (const path of [
      '/_admin/pages',
      '/_admin/posts/new',
      '/_admin/customize',
      '/_admin/media',
      '/_admin/settings',
      '/_admin/tools',
    ]) {
      const response = await page.goto(path)
      expect(response?.headers()['content-security-policy'], path).toContain("script-src 'self'")
      expect(response?.headers()['x-robots-tag'], path).toBe('noindex')
      await expect(page.locator('main')).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(await page.evaluate(() => window.__cspViolations), path).toEqual([])
    }
  })
})
