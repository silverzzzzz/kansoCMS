import { describe, expect, it } from 'vitest'
import { setupTokenHeaders, tokenFromHash } from './setup-token.ts'

describe('setup token', () => {
  it('reads the token from the link fragment', () => {
    expect(tokenFromHash('#token=abc_DEF-123')).toBe('abc_DEF-123')
    expect(tokenFromHash('token=abc')).toBe('abc')
    expect(tokenFromHash('#other=1&token=%20abc%20')).toBe('abc')
  })

  it('returns an empty string without a token', () => {
    expect(tokenFromHash('')).toBe('')
    expect(tokenFromHash('#')).toBe('')
    expect(tokenFromHash('#section')).toBe('')
  })

  it('sends the header only when a token was entered', () => {
    expect(setupTokenHeaders(' abc ')).toEqual({ headers: { 'x-setup-token': 'abc' } })
    expect(setupTokenHeaders('  ')).toBeUndefined()
  })
})
