import { defineConfig } from 'drizzle-kit'

// Used only for `drizzle-kit generate`. Migrations are applied with
// `wrangler d1 migrations apply`, which reads ./migrations via the
// `migrations_dir` in apps/server/wrangler.jsonc.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
})
