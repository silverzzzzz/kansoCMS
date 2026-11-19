import { KansoError, type KansoErrorCode } from '@kanso/core'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from '../env.ts'

const STATUS_BY_CODE: Record<KansoErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  rate_limited: 429,
  internal: 500,
}

function retryAfterSeconds(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('retryAfter' in details)) return null
  const value = details.retryAfter
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : null
}

/**
 * Single place where domain errors become HTTP responses. JSON for /api,
 * plain text elsewhere (the site router renders its own themed 404 before
 * anything reaches here).
 */
export function onError(err: Error, c: Context<AppEnv>) {
  const wantsJson = c.req.path.startsWith('/api/')

  if (err instanceof KansoError) {
    const status = STATUS_BY_CODE[err.code]
    const retryAfter = err.code === 'rate_limited' ? retryAfterSeconds(err.details) : null
    if (retryAfter !== null) c.header('retry-after', String(retryAfter))
    if (wantsJson) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        status,
      )
    }
    return c.text(err.message, status)
  }

  console.error(
    JSON.stringify({ level: 'error', path: c.req.path, message: err.message, stack: err.stack }),
  )
  if (wantsJson) {
    return c.json({ error: { code: 'internal', message: 'Internal Server Error' } }, 500)
  }
  return c.text('Internal Server Error', 500)
}
