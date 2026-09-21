import { describe, expect, it } from 'vitest'
import { SEARCH_PER_PAGE, searchQuerySchema } from './search.ts'
import { isReservedSlug } from './slug.ts'

describe('search query', () => {
  it('trims the query and supplies pagination defaults', () => {
    expect(searchQuerySchema.parse({ q: ' 東京 ' })).toEqual({
      q: '東京',
      page: 1,
      perPage: SEARCH_PER_PAGE,
    })
    expect(searchQuerySchema.parse({ q: 'hello', page: '2', perPage: '50' })).toEqual({
      q: 'hello',
      page: 2,
      perPage: 50,
    })
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(100) }).success).toBe(true)
  })

  it.each([
    {},
    { q: '' },
    { q: '  ' },
    { q: 'a'.repeat(101) },
    { q: 'a', page: 0 },
    { q: 'a', page: 1.5 },
    { q: 'a', page: 'no' },
    { q: 'a', perPage: 0 },
    { q: 'a', perPage: 51 },
    { q: 'a', perPage: 1.5 },
  ])('rejects invalid queries: %j', (query) => {
    expect(searchQuerySchema.safeParse(query).success).toBe(false)
  })

  it('reserves the search route', () => {
    expect(isReservedSlug('search')).toBe(true)
  })
})
