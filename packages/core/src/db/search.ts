import type { AnyColumn, SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

/**
 * Case-insensitive (ASCII) substring match. Use this instead of
 * `like '%…%'`: D1 rejects LIKE/GLOB patterns longer than 50 bytes, which a
 * 17-character Japanese search term already exceeds.
 */
export function contains(column: AnyColumn, query: string): SQL {
  return sql`instr(lower(${column}), lower(${query})) > 0`
}

/**
 * Rows whose `column` starts with `prefix` (exact, case-sensitive). The
 * LIKE-free form of `column like 'prefix%'`, for the same 50-byte limit.
 */
export function startsWith(column: AnyColumn, prefix: string): SQL {
  return sql`substr(${column}, 1, ${Array.from(prefix).length}) = ${prefix}`
}
