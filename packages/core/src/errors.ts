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
