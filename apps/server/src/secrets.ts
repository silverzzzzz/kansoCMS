import type { Bindings } from './env.ts'

export interface Secrets {
  TURNSTILE_SECRET_KEY?: string
}

function hasSecret(env: Bindings, name: keyof Secrets): env is Bindings & Secrets {
  return name in env
}

export function secret(env: Bindings, name: keyof Secrets): string | undefined {
  if (!hasSecret(env, name)) return undefined
  return env[name]?.trim() || undefined
}
