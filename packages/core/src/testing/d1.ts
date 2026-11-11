/// <reference path="./node.d.ts" />
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { D1Database } from '@cloudflare/workers-types'

/**
 * Test-only D1: an in-memory SQLite (Node's built-in driver) behind the part
 * of the D1 API drizzle uses, with every migration applied. It also enforces
 * the D1 limits that local development does not, so a unit test can catch
 * what would otherwise only fail in production:
 *
 * - at most 100 bound parameters per statement,
 * - LIKE patterns of at most 50 bytes,
 * - `queries()` counts D1 round trips (a `batch()` is one), to assert that a
 *   request stays inside the Workers Free budget of 50.
 */

const MIGRATIONS = new URL('../../migrations/', import.meta.url)
const MAX_BOUND_PARAMETERS = 100
const MAX_LIKE_PATTERN_BYTES = 50

type Mode = 'objects' | 'arrays'
type Row = Record<string, unknown>

export interface TestD1 {
  d1: D1Database
  /** D1 round trips since creation or the last `resetQueries()`. */
  queries(): number
  resetQueries(): void
  /** Run SQL directly (not counted), e.g. to age a row for a test. */
  exec(sql: string): void
  close(): void
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** SQLite's LIKE with D1's pattern-length limit. Arguments are (pattern, value[, escape]). */
function like(pattern: unknown, value: unknown, escapeArg?: unknown): number | null {
  if (pattern === null || value === null) return null
  const source = String(pattern)
  if (new TextEncoder().encode(source).length > MAX_LIKE_PATTERN_BYTES) {
    throw new Error('LIKE or GLOB pattern too complex')
  }
  const escapeChar = typeof escapeArg === 'string' ? escapeArg : null
  const chars = Array.from(source)
  let expression = '^'
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? ''
    if (escapeChar !== null && char === escapeChar && index + 1 < chars.length) {
      index += 1
      expression += escapeRegExp(chars[index] ?? '')
    } else if (char === '%') expression += '[\\s\\S]*'
    else if (char === '_') expression += '[\\s\\S]'
    else expression += escapeRegExp(char)
  }
  return new RegExp(`${expression}$`, 'i').test(String(value)) ? 1 : 0
}

function toSqliteValue(value: unknown): unknown {
  if (value === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported")
  if (typeof value === 'boolean') return value ? 1 : 0
  if (
    value instanceof Date ||
    (typeof value === 'object' &&
      value !== null &&
      !ArrayBuffer.isView(value) &&
      !(value instanceof ArrayBuffer))
  ) {
    throw new Error(`D1_TYPE_ERROR: Type 'object' not supported for value '${String(value)}'`)
  }
  return value
}

export function createTestD1(): TestD1 {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  database.function('like', { varargs: true, deterministic: true }, (...args) =>
    like(args[0], args[1], args[2]),
  )
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    database.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }

  let queries = 0

  function execute(sql: string, params: unknown[], mode: Mode) {
    if (params.length > MAX_BOUND_PARAMETERS) {
      throw new Error('D1_ERROR: too many SQL variables: SQLITE_ERROR')
    }
    const statement = database.prepare(sql)
    if (mode === 'arrays') statement.setReturnArrays(true)
    try {
      return statement.all(...params.map(toSqliteValue))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`D1_ERROR: ${message}: SQLITE_ERROR`)
    }
  }

  function result(rows: unknown[]) {
    const [meta] = database.prepare('select changes() as changes, last_insert_rowid() as id').all()
    const { changes, id } = meta as { changes: number; id: number }
    return {
      results: rows as Row[],
      success: true as const,
      meta: { changes, last_row_id: id, duration: 0, rows_read: 0, rows_written: changes },
    }
  }

  class Statement {
    constructor(
      readonly sql: string,
      readonly params: unknown[] = [],
    ) {}

    bind(...params: unknown[]) {
      return new Statement(this.sql, params)
    }

    async all() {
      queries += 1
      return result(execute(this.sql, this.params, 'objects'))
    }

    async run() {
      return this.all()
    }

    async raw() {
      queries += 1
      return execute(this.sql, this.params, 'arrays')
    }

    async first(column?: string) {
      queries += 1
      const [row] = execute(this.sql, this.params, 'objects') as Row[]
      if (!row) return null
      return column === undefined ? row : (row[column] ?? null)
    }
  }

  const d1 = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      queries += 1
      database.exec('BEGIN')
      try {
        const results = statements.map((statement) =>
          result(execute(statement.sql, statement.params, 'objects')),
        )
        database.exec('COMMIT')
        return results
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
    async exec(sql: string) {
      queries += 1
      database.exec(sql)
      return { count: 1, duration: 0 }
    },
  }

  return {
    d1: d1 as unknown as D1Database,
    queries: () => queries,
    resetQueries: () => {
      queries = 0
    },
    exec: (sql) => database.exec(sql),
    close: () => database.close(),
  }
}
