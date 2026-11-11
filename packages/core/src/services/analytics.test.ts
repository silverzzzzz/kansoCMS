import { describe, expect, it } from 'vitest'
import { createTestKanso } from '../testing/index.ts'
import { analyticsDayKey, analyticsDayKeys, BOT_UA_PATTERN } from './analytics.ts'

describe('analyticsDayKey', () => {
  it('buckets by the site timezone, not UTC', () => {
    // 2026-01-01T00:30Z is already Jan 1 09:30 in Tokyo but still Dec 31 in UTC.
    const date = new Date('2026-01-01T00:30:00Z')
    expect(analyticsDayKey(date, 'Asia/Tokyo')).toBe('2026-01-01')
    expect(analyticsDayKey(date, 'UTC')).toBe('2026-01-01')
    // 23:00 UTC is 08:00 next day in Tokyo.
    expect(analyticsDayKey(new Date('2026-01-01T23:00:00Z'), 'Asia/Tokyo')).toBe('2026-01-02')
    expect(analyticsDayKey(new Date('2026-01-01T23:00:00Z'), 'America/New_York')).toBe('2026-01-01')
  })
})

describe('BOT_UA_PATTERN', () => {
  it('matches common crawlers and misses normal browsers', () => {
    expect(BOT_UA_PATTERN.test('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(BOT_UA_PATTERN.test('curl/8.0')).toBe(true)
    expect(BOT_UA_PATTERN.test('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605')).toBe(false)
  })
})

describe('analyticsDayKeys', () => {
  it('lists consecutive calendar days ending today in the site timezone', () => {
    // 2026-03-01T16:00Z is already March 2 in Tokyo.
    expect(analyticsDayKeys(3, 'Asia/Tokyo', new Date('2026-03-01T16:00:00Z'))).toEqual([
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
  })

  it('has no gap or repeat across a daylight-saving change', () => {
    // New York leaves DST on 2026-11-01.
    const keys = analyticsDayKeys(4, 'America/New_York', new Date('2026-11-02T04:30:00Z'))
    expect(keys).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
  })
})

describe('analytics summary', () => {
  it('returns every day of the window, with zeros for days without views', async () => {
    const test = createTestKanso()
    const now = new Date('2026-11-12T03:00:00Z')
    test.exec(`
      insert into pageview_daily (day, path, count) values
        ('2026-11-10', '/', 4), ('2026-11-10', '/about', 1),
        ('2026-11-12', '/', 2), ('2026-10-01', '/old', 9)
    `)

    const summary = await test.kanso.analytics.summary(4, 'Asia/Tokyo', now)

    expect(summary.daily).toEqual([
      { day: '2026-11-09', count: 0 },
      { day: '2026-11-10', count: 5 },
      { day: '2026-11-11', count: 0 },
      { day: '2026-11-12', count: 2 },
    ])
    expect(summary.top).toEqual([
      { path: '/', count: 6 },
      { path: '/about', count: 1 },
    ])
    test.close()
  })
})
