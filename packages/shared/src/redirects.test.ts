import { describe, expect, it } from 'vitest'
import { createRedirectSchema, normalizeRedirectPath, redirectFromPathSchema } from './redirects.ts'

describe('redirect schemas', () => {
  it('normalizes redirect source paths', () => {
    expect(normalizeRedirectPath(' /old//path/ ')).toBe('old/path')
    expect(redirectFromPathSchema.parse(' /old/path/ ')).toBe('old/path')
  })

  it.each(['', '/', 'admin/x', 'old?query=1'])('rejects invalid source path %s', (fromPath) => {
    expect(redirectFromPathSchema.safeParse(fromPath).success).toBe(false)
  })

  it('rejects a path target equal to its source', () => {
    const result = createRedirectSchema.safeParse({ fromPath: 'old', to: '/old/' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['to'], message: 'Redirect target equals its source' }),
      )
    }
  })

  it('accepts an external URL and defaults to 301', () => {
    expect(createRedirectSchema.parse({ fromPath: 'old', to: 'https://example.com/' })).toEqual({
      fromPath: 'old',
      to: 'https://example.com/',
      status: 301,
    })
  })
})
