import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { isUniqueViolation } from './errors.ts'

describe('isUniqueViolation', () => {
  it('detects a bare SQLite unique constraint error', () => {
    const error = new Error('D1_ERROR: UNIQUE constraint failed: forms.slug: SQLITE_CONSTRAINT')
    expect(isUniqueViolation(error)).toBe(true)
  })

  it('looks through the DrizzleQueryError cause chain', () => {
    const cause = new Error('UNIQUE constraint failed: forms.slug')
    const error = new DrizzleQueryError('insert into "forms" ...', [], cause)
    expect(isUniqueViolation(error)).toBe(true)
  })

  it('ignores unrelated errors and non-errors', () => {
    expect(isUniqueViolation(new Error('NOT NULL constraint failed: forms.name'))).toBe(false)
    expect(isUniqueViolation('UNIQUE constraint failed')).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})
