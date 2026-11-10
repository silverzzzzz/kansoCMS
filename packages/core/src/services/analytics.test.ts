import { describe, expect, it } from 'vitest'
import { analyticsDayKey, BOT_UA_PATTERN } from './analytics.ts'

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
