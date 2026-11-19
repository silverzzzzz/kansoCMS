import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestKanso, type TestKanso } from '../testing/index.ts'

const RULE = { limit: 3, windowSeconds: 600 }
const START = new Date('2026-11-19T10:00:00Z')

function at(seconds: number): Date {
  return new Date(START.getTime() + seconds * 1000)
}

describe('rate limits', () => {
  let test: TestKanso

  beforeEach(() => {
    test = createTestKanso()
  })

  afterEach(() => {
    test.close()
  })

  it('allows up to the limit in one window and refuses the next request', async () => {
    const results = []
    for (let index = 0; index < 4; index += 1) {
      results.push(await test.kanso.rateLimits.hit('auth:a', RULE, at(index)))
    }
    expect(results.map((result) => [result.allowed, result.count])).toEqual([
      [true, 1],
      [true, 2],
      [true, 3],
      [false, 4],
    ])
    // The window started at 10:00:00, so 597 s are left at 10:00:03.
    expect(results[3]?.retryAfter).toBe(597)
  })

  it('starts counting again in the next window, reusing the row', async () => {
    for (let index = 0; index < 4; index += 1) {
      await test.kanso.rateLimits.hit('auth:a', RULE, at(index))
    }
    const next = await test.kanso.rateLimits.hit('auth:a', RULE, at(600))
    expect(next).toEqual({ allowed: true, count: 1, retryAfter: 600 })
    await expect(test.d1.prepare('select count(*) as n from rate_limits').first('n')).resolves.toBe(
      1,
    )
  })

  it('counts keys separately', async () => {
    for (let index = 0; index < 3; index += 1) {
      await test.kanso.rateLimits.hit('auth:a', RULE, at(index))
    }
    expect((await test.kanso.rateLimits.hit('auth:a', RULE, at(5))).allowed).toBe(false)
    expect((await test.kanso.rateLimits.hit('auth:b', RULE, at(5))).allowed).toBe(true)
    expect((await test.kanso.rateLimits.hit('form:a', RULE, at(5))).allowed).toBe(true)
  })

  it('costs one D1 round trip per request', async () => {
    test.resetQueries()
    await test.kanso.rateLimits.hit('auth:a', RULE, at(0))
    await test.kanso.rateLimits.hit('auth:a', RULE, at(1))
    expect(test.queries()).toBe(2)
  })
})
