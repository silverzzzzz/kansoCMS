import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RATE_LIMITS } from './rate-limit.ts'
import { createTestApp, type TestApp } from './testing.ts'

const IP_A = '203.0.113.10'
const IP_B = '203.0.113.20'

async function loginOptions(test: TestApp, ip?: string) {
  return test.request('/api/v1/auth/passkey/options', {
    method: 'POST',
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  })
}

describe('rate limits on public endpoints', () => {
  let test: TestApp

  beforeEach(() => {
    test = createTestApp()
  })

  afterEach(() => {
    test.close()
  })

  it('refuses sign-in requests over the limit with 429 and Retry-After', async () => {
    for (let index = 0; index < RATE_LIMITS.auth.limit; index += 1) {
      expect((await loginOptions(test, IP_A)).status).toBe(200)
    }
    const refused = await loginOptions(test, IP_A)
    expect(refused.status).toBe(429)
    const retryAfter = Number(refused.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(RATE_LIMITS.auth.windowSeconds)
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } })

    // Another client is counted on its own.
    expect((await loginOptions(test, IP_B)).status).toBe(200)
  })

  it('stores a hash, not the address', async () => {
    await loginOptions(test, IP_A)
    const rows = await test.d1.prepare('select key from rate_limits').all<{ key: string }>()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]?.key).toMatch(/^auth:[0-9a-f]{32}$/)
    expect(rows.results[0]?.key).not.toContain(IP_A)
  })

  it('does not count requests that did not come through Cloudflare', async () => {
    for (let index = 0; index < RATE_LIMITS.auth.limit + 5; index += 1) {
      expect((await loginOptions(test)).status).toBe(200)
    }
    const rows = await test.d1.prepare('select count(*) as n from rate_limits').first('n')
    expect(rows).toBe(0)
  })

  it('shares the auth limit between sign-in, registration links and setup', async () => {
    for (let index = 0; index < RATE_LIMITS.auth.limit; index += 1) {
      await loginOptions(test, IP_A)
    }
    const headers = { 'cf-connecting-ip': IP_A }
    const link = await test.request('/api/v1/auth/passkey-link/options', {
      method: 'POST',
      json: { token: 'x'.repeat(43) },
      headers,
    })
    expect(link.status).toBe(429)
    const setup = await test.request('/api/v1/setup/options', {
      method: 'POST',
      json: { siteTitle: 'Site', name: 'Admin', email: 'admin@example.com' },
      headers,
    })
    expect(setup.status).toBe(429)
  })

  describe('form submissions', () => {
    beforeEach(async () => {
      await test.signIn()
      const form = await test.request('/api/v1/forms', {
        method: 'POST',
        json: {
          slug: 'contact',
          name: 'Contact',
          fields: [{ type: 'text', name: 'name', label: 'Name', required: true }],
        },
      })
      expect(form.status).toBe(201)
      const page = await test.request('/api/v1/pages', {
        method: 'POST',
        json: {
          title: 'Contact',
          slug: 'contact',
          status: 'published',
          bodyJson: { type: 'doc', content: [{ type: 'form', attrs: { slug: 'contact' } }] },
        },
      })
      expect(page.status).toBe(201)
      test.signOut()
    })

    it('limits the JSON API per client', async () => {
      const submit = (ip: string) =>
        test.request('/api/v1/public/forms/contact/submissions', {
          method: 'POST',
          json: { name: 'Visitor' },
          headers: { 'cf-connecting-ip': ip },
        })
      for (let index = 0; index < RATE_LIMITS.form.limit; index += 1) {
        expect((await submit(IP_A)).status).toBe(201)
      }
      const refused = await submit(IP_A)
      expect(refused.status).toBe(429)
      expect(refused.headers.get('retry-after')).toBeTruthy()
      expect((await submit(IP_B)).status).toBe(201)

      const count = await test.d1.prepare('select count(*) as n from form_submissions').first('n')
      expect(count).toBe(RATE_LIMITS.form.limit + 1)
    })

    it('re-renders the HTML form with a message and 429', async () => {
      const submit = () =>
        test.request('/contact', {
          method: 'POST',
          body: new URLSearchParams({ _form: 'contact', name: 'Visitor' }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'cf-connecting-ip': IP_A,
          },
        })
      for (let index = 0; index < RATE_LIMITS.form.limit; index += 1) {
        expect((await submit()).status).toBe(200)
      }
      const refused = await submit()
      expect(refused.status).toBe(429)
      expect(refused.headers.get('retry-after')).toBeTruthy()
      const html = await refused.text()
      expect(html).toContain('受け付けを一時的に止めています')
      // The visitor's input is kept for the retry.
      expect(html).toContain('value="Visitor"')
    })

    it('does not count submissions caught by the honeypot', async () => {
      for (let index = 0; index < RATE_LIMITS.form.limit + 3; index += 1) {
        const response = await test.request('/api/v1/public/forms/contact/submissions', {
          method: 'POST',
          json: { name: 'Bot', _hp: 'filled' },
          headers: { 'cf-connecting-ip': IP_A },
        })
        expect(response.status).toBe(201)
      }
      const rows = await test.d1.prepare('select count(*) as n from rate_limits').first('n')
      expect(rows).toBe(0)
    })
  })
})
