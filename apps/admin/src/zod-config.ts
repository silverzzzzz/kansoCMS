import { disableZodJit } from '@kanso/shared/zod-config'

// Imported first by main.tsx, and from the subpath rather than '@kanso/shared',
// so it runs before any schema module is evaluated or parsed: the admin's CSP
// has no 'unsafe-eval' (apps/server/src/security-headers.ts).
disableZodJit()
