import type { Context } from 'hono'
import type { AppEnv } from '../env.ts'
import { secret } from '../secrets.ts'

export async function turnstileConfig(
  c: Context<AppEnv>,
): Promise<{ siteKey: string; secretKey: string } | null> {
  const settings = await c.var.kanso.settings.forms()
  const secretKey = secret(c.env, 'TURNSTILE_SECRET_KEY')
  if (!settings.turnstileSiteKey || !secretKey) return null
  return { siteKey: settings.turnstileSiteKey, secretKey }
}
