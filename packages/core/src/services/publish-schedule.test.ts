import type { SQL } from 'drizzle-orm'
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { publishedNow } from './pages.ts'
import { postsListOrder, postsPublishedNow } from './posts.ts'

const dialect = new SQLiteAsyncDialect()

describe('published visibility conditions', () => {
  const now = new Date('2026-11-12T00:00:00Z')

  function compile(condition: SQL | undefined) {
    if (!condition) throw new Error('Condition is unexpectedly empty')
    return dialect.sqlToQuery(condition)
  }

  it('pages require published status and published_at <= now', () => {
    const query = compile(publishedNow(now))
    expect(query.sql).toContain('"pages"."status" = ?')
    expect(query.sql).toContain('"pages"."published_at" <= ?')
    expect(query.params).toEqual(['published', Math.floor(now.getTime() / 1000)])
  })

  it('posts require published status and published_at <= now', () => {
    const query = compile(postsPublishedNow(now))
    expect(query.sql).toContain('"posts"."status" = ?')
    expect(query.sql).toContain('"posts"."published_at" <= ?')
    expect(query.params).toEqual(['published', Math.floor(now.getTime() / 1000)])
  })

  it('orders public post lists pinned-first, then newest published', () => {
    const clauses = postsListOrder().map((clause) => compile(clause).sql)
    expect(clauses[0]).toBe('"posts"."pinned" desc')
    expect(clauses[1]).toBe('"posts"."published_at" desc')
  })
})
