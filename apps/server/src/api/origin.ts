import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'

/**
 * Origin for links handed to people (share links, invitations). Normally the
 * configured `SITE_URL`. While that is a `localhost` placeholder the request's
 * own origin is used instead, so a development server on another port still
 * produces links that open.
 */
export function publicOrigin(c: Context<AppEnv>): string {
  const requestOrigin = new URL(c.req.url).origin
  try {
    const configured = new URL(c.env.SITE_URL)
    return configured.hostname === 'localhost' ? requestOrigin : configured.origin
  } catch {
    return requestOrigin
  }
}
