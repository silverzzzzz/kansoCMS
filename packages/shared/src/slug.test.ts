import { describe, expect, it } from 'vitest'
import { isReservedSlug, slugify } from './slug.ts'

describe('slugify', () => {
  it('normalizes case, accents and separators', () => {
    expect(slugify('  Hello, Wörld!  ')).toBe('hello-world')
  })

  it('removes unsupported characters', () => {
    expect(slugify('猫 の ページ')).toBe('')
  })
})

describe('isReservedSlug', () => {
  it('recognizes system-owned paths', () => {
    expect(isReservedSlug('admin')).toBe(true)
    expect(isReservedSlug('sitemap.xml')).toBe(true)
  })

  it('allows ordinary slugs', () => {
    expect(isReservedSlug('about')).toBe(false)
  })
})
