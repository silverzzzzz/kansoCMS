export type KansoErrorCode =
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'stale'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'internal'

/**
 * Domain error. The HTTP layer maps `code` to a status; core never imports
 * anything HTTP-specific.
 */
export class KansoError extends Error {
  constructor(
    readonly code: KansoErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'KansoError'
  }

  static notFound(what: string) {
    return new KansoError('not_found', `${what} not found`)
  }

  static conflict(message: string) {
    return new KansoError('conflict', message)
  }

  /** The item was saved by someone else after the caller loaded it (409). */
  static stale(message: string) {
    return new KansoError('stale', message)
  }

  static validation(message: string, details?: unknown) {
    return new KansoError('validation', message, details)
  }

  static unauthorized(message = 'Authentication required') {
    return new KansoError('unauthorized', message)
  }

  static forbidden(message = 'Forbidden') {
    return new KansoError('forbidden', message)
  }

  /** Too many requests; `retryAfter` (seconds) becomes the `Retry-After` header. */
  static rateLimited(retryAfter: number, message = 'Too many requests. Try again later.') {
    return new KansoError('rate_limited', message, { retryAfter })
  }
}

/**
 * Refuses an update that started from an older version of the item. Timestamps
 * are stored in whole seconds, so both sides are compared at that precision.
 * Without `baseUpdatedAt` (API clients, revision restores) nothing is checked.
 */
export function assertUnchangedSince(
  what: string,
  updatedAt: Date,
  baseUpdatedAt: string | undefined,
): void {
  if (baseUpdatedAt === undefined) return
  const current = Math.floor(updatedAt.getTime() / 1000)
  const base = Math.floor(Date.parse(baseUpdatedAt) / 1000)
  if (current !== base) throw KansoError.stale(`${what} was changed after it was opened`)
}

/**
 * True when `error` is (or wraps) a SQLite UNIQUE constraint failure. Drizzle
 * wraps driver errors in `DrizzleQueryError` whose message is only the query,
 * so the `cause` chain has to be inspected.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (/unique constraint failed/i.test(current.message)) return true
    current = current.cause
  }
  return false
}
