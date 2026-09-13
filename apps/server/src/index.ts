import { app } from './app.ts'
import type { Bindings } from './env.ts'

// Compile-time guard: the hand-mirrored `Bindings` (env.ts) and the generated
// `Env` (worker-configuration.d.ts) must be mutually assignable. Adding a
// binding to wrangler.jsonc without updating env.ts fails `pnpm typecheck`.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _bindingsMatchEnv: MutuallyAssignable<Bindings, Env> = true

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
