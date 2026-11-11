import type { Principal } from '../middleware/auth.ts'

/** An administrator signed in to the admin UI (never an API key). */
export function isAdminSession(principal: Principal | undefined): boolean {
  return principal?.kind === 'session' && principal.user.role === 'admin'
}

export function canUseRawHtml(principal: Principal | undefined): boolean {
  return isAdminSession(principal)
}

export function currentUserId(principal: Principal | undefined): number | null {
  return principal?.kind === 'session' ? principal.user.id : null
}
