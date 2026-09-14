export type KansoErrorCode =
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
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

  static validation(message: string, details?: unknown) {
    return new KansoError('validation', message, details)
  }

  static unauthorized(message = 'Authentication required') {
    return new KansoError('unauthorized', message)
  }

  static forbidden(message = 'Forbidden') {
    return new KansoError('forbidden', message)
  }
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
