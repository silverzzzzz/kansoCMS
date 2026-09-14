import { KansoError } from '@kanso/core'
import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'
import { secret } from '../secrets.ts'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

function verificationFailed(): never {
  throw KansoError.validation('Turnstile verification failed')
}

export async function verifyTurnstile(
  secretKey: string,
  token: string | null | undefined,
  remoteIp: string | null,
): Promise<void> {
  if (!token?.trim()) verificationFailed()

  const body = new URLSearchParams({ secret: secretKey, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) verificationFailed()

    const result: unknown = await response.json()
    if (
      typeof result !== 'object' ||
      result === null ||
      !('success' in result) ||
      result.success !== true
    ) {
      verificationFailed()
    }
  } catch {
    verificationFailed()
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
