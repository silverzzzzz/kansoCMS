import { KansoError } from '@kanso/core'
import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'
import { secret } from '../secrets.ts'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

function verificationFailed(failureMessage: string): never {
  throw KansoError.validation(failureMessage)
}

export async function verifyTurnstile(
  secretKey: string,
  token: string | null | undefined,
  remoteIp: string | null,
  failureMessage: string,
): Promise<void> {
  if (!token?.trim()) verificationFailed(failureMessage)

  const body = new URLSearchParams({ secret: secretKey, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) verificationFailed(failureMessage)

    const result: unknown = await response.json()
    if (
      typeof result !== 'object' ||
      result === null ||
      !('success' in result) ||
      result.success !== true
    ) {
      verificationFailed(failureMessage)
    }
  } catch {
    verificationFailed(failureMessage)
  }
}

export async function turnstileConfig(
  c: Context<AppEnv>,
): Promise<{ siteKey: string; secretKey: string } | null> {
  const settings = await c.var.kanso.settings.forms()
  const secretKey = secret(c.env, 'TURNSTILE_SECRET_KEY')
  if (!settings.turnstileSiteKey || !secretKey) return null
  return { siteKey: settings.turnstileSiteKey, secretKey }
}
