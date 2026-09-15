import { defineConfig, devices } from '@playwright/test'

const port = 5199
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    extraHTTPHeaders: { origin: baseURL },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'pnpm --filter @kanso/admin build && pnpm --filter @kanso/server exec vite dev --port 5199',
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
