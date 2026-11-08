import type { RelyingParty } from '@kanso/core'
import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'

/**
 * Passkeys are bound to the host the admin is served from: the RP ID is the
 * request's hostname and the only accepted origin is the request's origin.
 * `name` is what authenticators show.
 *
 * Local development is the one exception. The admin's Vite dev server (:5174)
 * proxies `/api` to the Worker, which then sees its own port, so on
 * `localhost` the browser's `Origin` is accepted when it is also `localhost`.
 * The RP ID is `localhost` either way, which WebAuthn shares across ports.
 */
export function relyingParty(c: Context<AppEnv>, name = 'kansoCMS'): RelyingParty {
  const url = new URL(c.req.url)
  if (url.hostname === 'localhost') {
    const header = c.req.header('origin')
    if (header) {
      try {
        const origin = new URL(header)
        if (origin.hostname === 'localhost' && origin.origin === header) {
          return { id: 'localhost', origin: origin.origin, name }
        }
      } catch {
        // Not a URL: use the request's own origin.
      }
    }
  }
  return { id: url.hostname, origin: url.origin, name }
}
