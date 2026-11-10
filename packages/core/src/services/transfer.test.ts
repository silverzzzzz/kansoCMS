import { describe, expect, it } from 'vitest'
import { pageIdentity, sameJson, sortByPathDepth, stableStringify } from './transfer.ts'

describe('stableStringify', () => {
  it('is insensitive to object key order', () => {
    expect(stableStringify({ b: 1, a: { d: [2, { f: 1, e: 2 }], c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: [2, { e: 2, f: 1 }] }, b: 1 }),
    )
  })

  it('keeps array order significant', () => {
    expect(sameJson([1, 2], [2, 1])).toBe(false)
    expect(sameJson({ a: null }, {})).toBe(false)
  })
})

describe('pageIdentity', () => {
  it('derives slug and parent path from a nested path', () => {
    expect(pageIdentity('company/team/history')).toEqual({
      slug: 'history',
      parentPath: 'company/team',
    })
  })

  it('treats a top-level path as its own slug', () => {
    expect(pageIdentity('about')).toEqual({ slug: 'about', parentPath: null })
  })
})

describe('sortByPathDepth', () => {
  it('orders parents before children without mutating input', () => {
    const input = [
      { path: 'a/b/c' },
      { path: 'z' },
      { path: 'a/b' },
      { path: 'a' },
      { path: 'a/b/d' },
    ]
    const sorted = sortByPathDepth(input)
    expect(sorted.map((item) => item.path)).toEqual(['a', 'z', 'a/b', 'a/b/c', 'a/b/d'])
    expect(input[0]?.path).toBe('a/b/c')
  })
})
