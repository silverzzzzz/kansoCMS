import { SETUP_TOKEN_HEADER } from '@kanso/shared'

/**
 * `pnpm setup:token --url …` prints `/_admin/setup#token=…`. The fragment is
 * never sent to the server, so the token stays out of request logs.
 */
export function tokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token')?.trim() ?? ''
}

/** Request options that send the token with a setup step, when there is one. */
export function setupTokenHeaders(token: string): { headers: Record<string, string> } | undefined {
  const value = token.trim()
  return value ? { headers: { [SETUP_TOKEN_HEADER]: value } } : undefined
}
