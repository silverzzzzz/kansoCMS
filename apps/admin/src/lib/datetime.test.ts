import { describe, expect, it } from 'vitest'
import { formatDateTime, fromDateTimeLocal, toDateTimeLocal } from './datetime.ts'

describe('datetime-local conversion', () => {
  it('returns an empty value for null', () => {
    expect(toDateTimeLocal(null)).toBe('')
    expect(fromDateTimeLocal('')).toBeNull()
  })

  it('round-trips a local datetime', () => {
    const iso = fromDateTimeLocal('2026-09-11T14:30')
    expect(iso).not.toBeNull()
    expect(toDateTimeLocal(iso)).toBe('2026-09-11T14:30')
  })
})

describe('formatDateTime', () => {
  it('formats a value in Japanese and supports a custom empty value', () => {
    const value = '2026-09-15T01:02:00.000Z'
    const expected = new Intl.DateTimeFormat('ja-JP', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))

    expect(formatDateTime(value)).toBe(expected)
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(null, '')).toBe('')
  })
})
