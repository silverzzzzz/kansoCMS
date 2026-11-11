import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, stubSiteCache, type TestApp } from '../testing.ts'
import { resetPageviewTimezone } from './pageviews.ts'

describe('pageview counting', () => {
  let test: TestApp

  beforeEach(async () => {
    resetPageviewTimezone()
    stubSiteCache()
    test = createTestApp()
    await test.kanso.pages.create(
      { title: 'About', slug: 'about', status: 'published' },
      { allowRawHtml: false },
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    test.close()
  })

  async function views(path = '/about') {
    await test.flush()
    const summary = await test.kanso.analytics.summary(1, 'Asia/Tokyo')
    return summary.top.find((row) => row.path === path)?.count ?? 0
  }

  it('counts responses served from the site cache', async () => {
    const first = await test.request('/about')
    await test.flush()
    const second = await test.request('/about')
    const third = await test.request('/about')

    expect(first.headers.get('x-kanso-cache')).toBe('MISS')
    expect(second.headers.get('x-kanso-cache')).toBe('HIT')
    expect(third.headers.get('x-kanso-cache')).toBe('HIT')
    expect(await views()).toBe(3)
  })

  it('does not count signed-in staff', async () => {
    await test.request('/about')
    await test.signIn()
    await test.request('/about')
    await test.request('/about')

    expect(await views()).toBe(1)
  })

  it('does not count bots, missing pages, feeds or the search page', async () => {
    await test.request('/about', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    })
    await test.request('/nope')
    await test.request('/search?q=about')
    await test.request('/sitemap.xml')
    await test.flush()

    const summary = await test.kanso.analytics.summary(1, 'Asia/Tokyo')
    expect(summary.top).toEqual([])
  })

  it('counts a page whose path merely starts with "search"', async () => {
    await test.kanso.pages.create(
      { title: 'Search tips', slug: 'search-tips', status: 'published' },
      { allowRawHtml: false },
    )
    await test.request('/search-tips')
    expect(await views('/search-tips')).toBe(1)
  })

  it('spends one query per cached view on the counter', async () => {
    await test.request('/about')
    await test.flush()
    test.resetQueries()
    await test.request('/about')
    await test.flush()
    // cache generation + the pageview upsert (the timezone is remembered).
    expect(test.queries()).toBe(2)
  })
})
