import { describe, expect, it } from 'vitest'
import { fromDateTimeLocal, toDateTimeLocal } from './datetime.ts'

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
