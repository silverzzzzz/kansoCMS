import { KansoError } from '@kanso/core'
import { SETUP_TOKEN_HEADER, SETUP_TOKEN_MIN_LENGTH, type SetupTokenState } from '@kanso/shared'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env.ts'
import { secret } from '../secrets.ts'

/**
 * What first-run setup demands of the request:
 * - `off`: nothing. Only on `localhost` without a configured token, so local
 *   development and E2E set up as before.
 * - `required`: the `SETUP_TOKEN` secret, sent in the `x-setup-token` header.
 * - `unset`: setup is refused until a token of at least 16 characters is
 *   configured. Every deployed site starts here, which closes the window in
 *   which whoever opens /_admin/setup first would become the administrator.
 */
export function setupTokenState(c: Context<AppEnv>): SetupTokenState {
  const token = secret(c.env, 'SETUP_TOKEN')
  if (token !== undefined) return token.length >= SETUP_TOKEN_MIN_LENGTH ? 'required' : 'unset'
  return new URL(c.req.url).hostname === 'localhost' ? 'off' : 'unset'
}

export const requireSetupToken = createMiddleware<AppEnv>(async (c, next) => {
  const state = setupTokenState(c)
  if (state === 'unset') {
    throw KansoError.forbidden(
      `Setup is locked: set a SETUP_TOKEN secret of at least ${SETUP_TOKEN_MIN_LENGTH} characters (pnpm setup:token)`,
    )
  }
  if (state === 'required') {
    const expected = secret(c.env, 'SETUP_TOKEN') ?? ''
    const given = c.req.header(SETUP_TOKEN_HEADER)?.trim() ?? ''
    if (!(await sameText(given, expected))) {
      throw KansoError.forbidden('The setup token is missing or wrong')
    }
  }
  await next()
})

/** Compares SHA-256 digests so the time taken does not depend on the token. */
async function sameText(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all(
    [left, right].map(
      async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))),
    ),
  )
  if (!a || !b) return false
  let difference = 0
  for (const [index, byte] of a.entries()) difference |= byte ^ (b[index] ?? 0)
  return difference === 0
}
