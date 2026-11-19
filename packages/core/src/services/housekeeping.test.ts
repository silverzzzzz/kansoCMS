import { TRASH_RETENTION_DAYS } from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestKanso, type TestKanso } from '../testing/index.ts'

const context = { allowRawHtml: false }
const DAY = 86_400

describe('housekeeping', () => {
  let test: TestKanso
  // The real clock: links and sessions created through the services expire relative to it.
  const now = new Date()
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const dayKey = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * DAY * 1000).toISOString().slice(0, 10)

  beforeEach(() => {
    test = createTestKanso()
  })
  afterEach(() => test.close())

  /** Pretend the row went to the trash `days` ago. */
  function trashedAgo(table: 'pages' | 'posts', id: number, days: number) {
    test.exec(`update ${table} set deleted_at = ${nowSeconds - days * DAY} where id = ${id}`)
  }

  it('purges pages and posts trashed longer ago than the retention period', async () => {
    const type = await test.kanso.postTypes.create({ slug: 'news', name: 'News' })
    const page = (slug: string, parentId: number | null = null) =>
      test.kanso.pages.create({ title: slug, slug, parentId, status: 'published' }, context)
    const post = (slug: string) =>
      test.kanso.posts.create(
        { postTypeId: type.id, slug, title: slug, status: 'published' },
        { ...context, authorId: null },
      )
    const stale = await page('stale')
    const staleChild = await page('child', stale.id)
    const recent = await page('recent')
    const live = await page('live')
    const stalePost = await post('stale')
    const recentPost = await post('recent')
    // History and share links of what gets purged must go with it.
    await test.kanso.pages.update(stale.id, { title: 'Stale v2' }, { ...context, userId: null })
    await test.kanso.shareLinks.create({ targetType: 'page', targetId: stale.id, createdBy: null })
    await test.kanso.shareLinks.create({ targetType: 'page', targetId: live.id, createdBy: null })

    await test.kanso.pages.delete(stale.id) // cascades to the child
    await test.kanso.pages.delete(recent.id)
    await test.kanso.posts.delete(stalePost.id)
    await test.kanso.posts.delete(recentPost.id)
    for (const id of [stale.id, staleChild.id]) trashedAgo('pages', id, TRASH_RETENTION_DAYS + 1)
    trashedAgo('pages', recent.id, TRASH_RETENTION_DAYS - 1)
    trashedAgo('posts', stalePost.id, TRASH_RETENTION_DAYS + 1)
    trashedAgo('posts', recentPost.id, 1)

    test.resetQueries()
    const report = await test.kanso.housekeeping.run(now)

    expect(test.queries()).toBe(1)
    expect(report).toMatchObject({ pages: 2, posts: 1 })
    const trashedPages = await test.kanso.pages.list({ trashed: 'true' })
    expect(trashedPages.items.map((row) => row.id)).toEqual([recent.id])
    expect((await test.kanso.posts.list({ trashed: 'true' })).items.map((row) => row.id)).toEqual([
      recentPost.id,
    ])
    await expect(test.kanso.pages.get(live.id)).resolves.toMatchObject({ slug: 'live' })
    expect(await test.kanso.revisions.list('page', stale.id)).toEqual([])
    expect(await test.kanso.shareLinks.listFor('page', stale.id)).toEqual([])
    expect(await test.kanso.shareLinks.listFor('page', live.id)).toHaveLength(1)
    // The purged pages are gone from search as well (the index follows by trigger).
    expect((await test.kanso.search.search({ q: 'stale', page: 1, perPage: 10 })).total).toBe(0)
  })

  it('removes expired sessions, links and challenges but keeps valid ones', async () => {
    test.exec(`insert into users (email, name, role) values ('a@example.com', 'A', 'admin')`)
    const valid = await test.kanso.auth.createSession(1)
    const expired = nowSeconds - 60
    const future = nowSeconds + 3600
    test.exec(`
      insert into sessions (id, user_id, expires_at) values ('old-session', 1, ${expired});
      insert into passkey_links (id, user_id, expires_at) values ('old-link', 1, ${expired}), ('new-link', 1, ${future});
      insert into auth_challenges (id, purpose, expires_at) values ('old-challenge', 'login', ${expired}), ('new-challenge', 'login', ${future});
      insert into share_links (id, target_type, target_id, expires_at) values ('old-share', 'page', 1, ${expired}), ('new-share', 'page', 1, ${future});
    `)

    const report = await test.kanso.housekeeping.run(now)

    expect(report).toMatchObject({ sessions: 1, passkeyLinks: 1, challenges: 1, shareLinks: 1 })
    expect(await test.kanso.auth.getSessionUser(valid.token)).toMatchObject({ id: 1 })
  })

  it('drops pageview rows older than about a year', async () => {
    test.exec(`insert into pageview_daily (day, path, count) values
      ('${dayKey(500)}', '/', 3), ('${dayKey(1)}', '/', 5)`)

    const report = await test.kanso.housekeeping.run(now)

    expect(report.pageviewRows).toBe(1)
    const summary = await test.kanso.analytics.summary(30, 'UTC', now)
    expect(summary.top).toEqual([{ path: '/', count: 5 }])
  })

  it('drops rate-limit counters older than a day', async () => {
    test.exec(`insert into rate_limits (key, window_start, count) values
      ('auth:old', ${nowSeconds - 2 * 86_400}, 30), ('auth:recent', ${nowSeconds - 600}, 2)`)

    const report = await test.kanso.housekeeping.run(now)

    expect(report.rateLimitRows).toBe(1)
    const keys = await test.d1.prepare('select key from rate_limits').all<{ key: string }>()
    expect(keys.results.map((row) => row.key)).toEqual(['auth:recent'])
  })

  it('does nothing on a tidy site', async () => {
    const report = await test.kanso.housekeeping.run(now)
    expect(report).toEqual({
      pages: 0,
      posts: 0,
      shareLinks: 0,
      sessions: 0,
      passkeyLinks: 0,
      challenges: 0,
      pageviewRows: 0,
      rateLimitRows: 0,
    })
  })
})
