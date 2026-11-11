import type { Ai } from '@cloudflare/workers-types'
import type { Bindings } from './env.ts'

/**
 * Bindings a site may add to wrangler.jsonc. They are not part of the default
 * configuration, so the generated `Env` (and `Bindings`) does not list them.
 */
export interface OptionalBindings {
  /** Workers AI, for the admin "AI で生成" assist. Always remote, hence opt-in. */
  AI?: Ai
}

export function aiBinding(env: Bindings): Ai | undefined {
  const optional: Bindings & OptionalBindings = env
  return optional.AI
}
