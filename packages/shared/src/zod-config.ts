import { z } from 'zod'

/**
 * Turns off zod's compiled (`new Function`) fast path. zod probes for it with
 * a caught `new Function('')`, and under a CSP without `'unsafe-eval'` (the
 * admin's) the browser reports that probe as a policy violation even though
 * zod falls back. Call it before the first parse.
 */
export function disableZodJit(): void {
  z.config({ jitless: true })
}
