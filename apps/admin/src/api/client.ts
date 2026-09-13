import type { ApiType } from '@kanso/server/api'
import { hc } from 'hono/client'

/**
 * Typed RPC client. `ApiType` is a type-only import from the Worker, so the
 * admin bundle never pulls server code. Same-origin in production; proxied by
 * Vite in dev.
 */
export const api = hc<ApiType>('/api/v1', {
  init: { credentials: 'same-origin' },
})
