import { KansoError, type RateLimitRule } from '@kanso/core'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from './env.ts'

/**
 * Limits per client IP for the endpoints anyone can call that write to D1 or
 * send mail. A sign-in or setup attempt is two requests (options + verify).
 */
export const RATE_LIMITS = {
  /** Passkey sign-in, registration links and first-admin setup. */
  auth: { limit: 30, windowSeconds: 600 },
  /** Public form submissions, JSON API and HTML forms alike. */
  form: { limit: 10, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitBucket = keyof typeof RATE_LIMITS

/** The address is hashed before it is stored; the row only lives about a day. */
async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
  return Array.from(new Uint8Array(digest).subarray(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Counts this request against `bucket` and throws a 429 `KansoError` once the
 * client is over the limit. The client is `CF-Connecting-IP`, which Cloudflare
 * sets on every request it forwards; without it (a request that did not come
 * through Cloudflare) nothing is counted, since there is no client to tell apart.
 */
export async function enforceRateLimit(
  c: Context<AppEnv>,
  bucket: RateLimitBucket,
  message?: string,
): Promise<void> {
  const ip = c.req.header('cf-connecting-ip')?.trim()
  if (!ip) return
  const result = await c.var.kanso.rateLimits.hit(
    `${bucket}:${await hashIp(ip)}`,
    RATE_LIMITS[bucket],
  )
  if (!result.allowed) throw KansoError.rateLimited(result.retryAfter, message)
}

/** Route middleware form of `enforceRateLimit`. */
export function rateLimit(bucket: RateLimitBucket) {
  return createMiddleware<AppEnv>(async (c, next) => {
    await enforceRateLimit(c, bucket)
    await next()
  })
}
