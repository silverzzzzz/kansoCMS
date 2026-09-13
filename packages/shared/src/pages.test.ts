import { describe, expect, it } from 'vitest'
import { createPageSchema, updatePageSchema } from './pages.ts'

describe('page input schemas', () => {
  it('does not apply defaults to an empty update', () => {
    expect(updatePageSchema.parse({})).toEqual({})
  })

  it('requires title and slug on create but allows all other fields to be omitted', () => {
    expect(createPageSchema.parse({ title: 'About', slug: 'about' })).toEqual({
      title: 'About',
      slug: 'about',
    })
    expect(createPageSchema.safeParse({ slug: 'about' }).success).toBe(false)
    expect(createPageSchema.safeParse({ title: 'About' }).success).toBe(false)
  })

  it('rejects a non-ISO publishedAt value', () => {
    expect(updatePageSchema.safeParse({ publishedAt: 'tomorrow' }).success).toBe(false)
  })
})
