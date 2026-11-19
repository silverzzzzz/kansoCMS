import { describe, expect, it } from 'vitest'
import {
  createRedirectSchema,
  normalizeRedirectPath,
  parseRedirectCsv,
  REDIRECT_IMPORT_MAX_ROWS,
  redirectFromPathSchema,
  updateRedirectSchema,
} from './redirects.ts'

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

  it('takes a 410 rule without a target', () => {
    expect(createRedirectSchema.parse({ fromPath: '/removed/', status: 410 })).toEqual({
      fromPath: 'removed',
      to: '',
      status: 410,
    })
  })

  it('refuses a target on a 410 rule and a missing target on 301/302', () => {
    const gone = createRedirectSchema.safeParse({ fromPath: 'old', to: '/new', status: 410 })
    expect(gone.success).toBe(false)
    expect(gone.error?.issues[0]).toMatchObject({
      path: ['to'],
      message: 'A 410 rule has no target',
    })

    for (const status of [301, 302] as const) {
      expect(createRedirectSchema.safeParse({ fromPath: 'old', to: '', status }).success).toBe(
        false,
      )
      expect(createRedirectSchema.safeParse({ fromPath: 'old', status }).success).toBe(false)
    }
    expect(createRedirectSchema.safeParse({ fromPath: 'old', to: 'javascript:x' }).success).toBe(
      false,
    )
  })

  it('leaves an empty target in a partial update to the service', () => {
    expect(updateRedirectSchema.safeParse({ to: '' }).success).toBe(true)
    expect(updateRedirectSchema.safeParse({ to: '', status: 301 }).success).toBe(false)
    expect(updateRedirectSchema.safeParse({ status: 410 }).success).toBe(true)
  })
})

describe('parseRedirectCsv', () => {
  it('parses rows with and without a status column', () => {
    const { rows, truncated } = parseRedirectCsv('/old,/new,301\n/legacy,/modern')

    expect(truncated).toBe(false)
    expect(rows).toEqual([
      { line: 1, fromPath: '/old', to: '/new', status: '301' },
      { line: 2, fromPath: '/legacy', to: '/modern', status: '' },
    ])
  })

  it('skips a header row, blank lines, and comments', () => {
    const { rows } = parseRedirectCsv('from_path,to,status\n\n# note\n/a,/b,302\n')

    expect(rows).toEqual([{ line: 4, fromPath: '/a', to: '/b', status: '302' }])
  })

  it('keeps commas inside quoted fields', () => {
    const { rows } = parseRedirectCsv('/old,"https://example.com/a,b",301')

    expect(rows[0]?.to).toBe('https://example.com/a,b')
  })

  it('reports truncation past the row cap', () => {
    const csv = Array.from({ length: REDIRECT_IMPORT_MAX_ROWS + 5 }, (_, i) => `/a${i},/b`).join(
      '\n',
    )
    const { rows, truncated } = parseRedirectCsv(csv)

    expect(rows).toHaveLength(REDIRECT_IMPORT_MAX_ROWS)
    expect(truncated).toBe(true)
  })
})
