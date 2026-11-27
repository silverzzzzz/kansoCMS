import { type APIRequestContext, test as base } from '@playwright/test'
import { apiLogin, cleanupE2E, ensureAdmin, shareSession } from './helpers.ts'

/** Editing scenarios use the same administrator across fresh browser contexts. */
export const test = base.extend<object, { api: APIRequestContext }>({
  api: [
    async ({ playwright }, use, worker) => {
      const baseURL = worker.project.use.baseURL
      if (!baseURL) throw new Error('Playwright baseURL is not configured')
      const api = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { origin: baseURL },
      })
      try {
        await ensureAdmin(api)
        await apiLogin(api)
        try {
          await use(api)
        } finally {
          await cleanupE2E(api)
        }
      } finally {
        await api.dispose()
      }
    },
    { scope: 'worker' },
  ],
  page: async ({ page, api }, use) => {
    await shareSession(page.context(), api)
    await use(page)
  },
})
