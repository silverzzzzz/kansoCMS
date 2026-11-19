import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestKanso, type TestKanso } from '../testing/index.ts'
import { NOT_FOUND_MAX_ROWS, NOT_FOUND_RETENTION_DAYS } from './housekeeping.ts'

describe('missing paths', () => {
  let test: TestKanso
  const now = new Date('2026-11-20T00:00:00Z')
  const nowSeconds = Math.floor(now.getTime() / 1000)

  beforeEach(() => {
    test = createTestKanso()
  })
  afterEach(() => test.close())

  it('counts a path with one upsert, normalised like a redirect source', async () => {
    test.resetQueries()
    await test.kanso.notFound.record('old/page', now)
    await test.kanso.notFound.record('/old/page/', new Date(now.getTime() + 60_000))
    expect(test.queries()).toBe(2)

    const { items, total } = await test.kanso.notFound.list()
    expect(total).toBe(1)
    expect(items[0]).toEqual({
      path: 'old/page',
      count: 2,
      firstSeen: '2026-11-20T00:00:00.000Z',
      lastSeen: '2026-11-20T00:01:00.000Z',
    })
  })

  it('ignores empty and overlong paths', async () => {
    await test.kanso.notFound.record('/', now)
    await test.kanso.notFound.record(`x/${'a'.repeat(400)}`, now)
    expect((await test.kanso.notFound.list()).total).toBe(0)
  })

  it('lists the most frequent first and forgets one or all', async () => {
    await test.kanso.notFound.record('rare', now)
    for (let index = 0; index < 3; index += 1) await test.kanso.notFound.record('often', now)
    expect((await test.kanso.notFound.list()).items.map((item) => item.path)).toEqual([
      'often',
      'rare',
    ])

    await test.kanso.notFound.dismiss('/often')
    expect((await test.kanso.notFound.list()).items.map((item) => item.path)).toEqual(['rare'])
    await test.kanso.notFound.dismiss()
    expect((await test.kanso.notFound.list()).total).toBe(0)
  })

  it('drops a path once a redirect or a 410 rule covers it', async () => {
    await test.kanso.notFound.record('moved', now)
    await test.kanso.notFound.record('removed', now)
    await test.kanso.notFound.record('imported', now)
    await test.kanso.redirects.create({ fromPath: 'moved', to: '/new', status: 301 })
    await test.kanso.redirects.create({ fromPath: 'removed', to: '', status: 410 })
    await test.kanso.redirects.importRows('/imported,/elsewhere')
    expect((await test.kanso.notFound.list()).total).toBe(0)
  })

  it('switches a rule to 410 and back, keeping the target rules', async () => {
    const rule = await test.kanso.redirects.create({ fromPath: 'old', to: '/new', status: 301 })
    const gone = await test.kanso.redirects.update(rule.id, { status: 410 })
    expect(gone).toMatchObject({ status: 410, to: '' })
    await expect(test.kanso.redirects.update(rule.id, { status: 301 })).rejects.toMatchObject({
      code: 'validation',
    })
    expect(await test.kanso.redirects.update(rule.id, { status: 302, to: '/back' })).toMatchObject({
      status: 302,
      to: '/back',
    })
  })

  it('is purged after 30 days without a request and beyond 1,000 rows', async () => {
    const old = new Date((nowSeconds - (NOT_FOUND_RETENTION_DAYS + 1) * 86_400) * 1000)
    await test.kanso.notFound.record('forgotten', old)
    const values = Array.from(
      { length: NOT_FOUND_MAX_ROWS + 5 },
      (_, index) => `('p${index}', 1, ${nowSeconds - index}, ${nowSeconds - index})`,
    )
    test.exec(
      `insert into not_found_paths (path, count, first_seen, last_seen) values ${values.join(',')}`,
    )

    const report = await test.kanso.housekeeping.run(now)

    expect(report.notFoundRows).toBe(6)
    const { items, total } = await test.kanso.notFound.list()
    expect(total).toBe(NOT_FOUND_MAX_ROWS)
    // The most recently requested paths are the ones kept.
    expect(items.some((item) => item.path === 'p0')).toBe(true)
    const kept = await test.d1
      .prepare(`select count(*) as n from not_found_paths where path in ('forgotten', 'p1004')`)
      .first('n')
    expect(kept).toBe(0)
  })
})
