import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types'
import type { Kanso } from '@kanso/core'
import type { Principal } from './middleware/auth.ts'

/**
 * Mirror of the generated `Env` (worker-configuration.d.ts) written with
 * module types instead of ambient globals. This is what lets apps/admin do
 * `import type { ApiType }` and type-check without Workers globals, which
 * would collide with lib.dom and drag hono/jsx files into a React program.
 *
 * It must stay identical to the generated `Env`; `index.ts` asserts that at
 * compile time, so drift is a type error rather than a runtime surprise.
 */
export interface Bindings {
  DB: D1Database
  MEDIA: R2Bucket
  ASSETS: Fetcher
  /** Absolute origin, no trailing slash. */
  SITE_URL: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    kanso: Kanso
    principal?: Principal
  }
}
