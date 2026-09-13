import { describe, expect, it } from 'vitest'
import { siteCacheKey } from './cache.ts'

describe('siteCacheKey', () => {
  it('keeps only the raw page value', () => {
    expect(siteCacheKey('https://example.com/blog?page=2&utm_source=x')).toBe(
      'https://example.com/blog?page=2',
    )
    expect(siteCacheKey('https://example.com/blog?page=abc')).toBe(
      'https://example.com/blog?page=abc',
    )
  })

  it('drops unrelated query parameters', () => {
    expect(siteCacheKey('https://example.com/blog?utm_source=x')).toBe('https://example.com/blog')
  })
})
