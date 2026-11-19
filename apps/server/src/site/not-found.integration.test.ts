import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing.ts'

type NotFoundList = { items: { path: string; count: number }[]; total: number }

/** 404 counting on the public site, 410 rules, and the admin API around them. */
describe('missing paths on the public site', () => {
  let test: TestApp
  let signedIn = false

  beforeEach(() => {
    test = createTestApp()
    signedIn = false
  })

  afterEach(() => {
    test.close()
  })

  /** Signs in once per test (the helper creates a user each time). */
  async function signIn() {
    if (!signedIn) await test.signIn()
    signedIn = true
  }

  async function listMissing() {
    await signIn()
    const response = await test.request('/api/v1/redirects/not-found')
    expect(response.status).toBe(200)
    return (await response.json()) as NotFoundList
  }

  it('counts GETs for paths nothing answers, without the query string', async () => {
    expect((await test.request('/old-page?utm_source=x')).status).toBe(404)
    expect((await test.request('/old-page/')).status).toBe(301)
    expect((await test.request('/old-page')).status).toBe(404)
    await test.flush()

    expect(await listMissing()).toMatchObject({
      total: 1,
      items: [{ path: 'old-page', count: 2 }],
    })
  })

  it('does not count 404s of paths that exist, or form posts', async () => {
    await signIn()
    await test.request('/api/v1/post-types', {
      method: 'POST',
      json: { slug: 'news', name: 'News' },
    })
    // An archive page beyond the last one answers 404 but the path itself exists.
    expect((await test.request('/news?page=9')).status).toBe(404)
    expect(
      (
        await test.request('/nowhere', {
          method: 'POST',
          body: new URLSearchParams({ _form: 'contact' }),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        })
      ).status,
    ).toBe(404)
    await test.flush()

    expect((await listMissing()).total).toBe(0)
  })

  it('answers 410 for a gone rule and stops listing the path', async () => {
    await test.request('/retired')
    await test.flush()
    await signIn()
    const rule = await test.request('/api/v1/redirects', {
      method: 'POST',
      json: { fromPath: '/retired', status: 410 },
    })
    expect(rule.status).toBe(201)

    const response = await test.request('/retired')
    expect(response.status).toBe(410)
    const html = await response.text()
    expect(html).toContain('<h1>410</h1>')
    expect(html).toContain('name="robots" content="noindex, follow"')
    await test.flush()

    expect((await listMissing()).total).toBe(0)
  })

  it('dismisses one path or all of them through the API', async () => {
    await test.request('/a')
    await test.request('/b/c')
    await test.flush()
    await signIn()

    const one = await test.request('/api/v1/redirects/not-found?path=%2Fb%2Fc', {
      method: 'DELETE',
    })
    expect(one.status).toBe(200)
    expect((await listMissing()).items.map((item) => item.path)).toEqual(['a'])

    await test.request('/api/v1/redirects/not-found', { method: 'DELETE' })
    expect((await listMissing()).total).toBe(0)
  })
})
