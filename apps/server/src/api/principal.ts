import type { Principal } from '../middleware/auth.ts'

export function canUseRawHtml(principal: Principal | undefined): boolean {
  return principal?.kind === 'session' && principal.user.role === 'admin'
}

export function currentUserId(principal: Principal | undefined): number | null {
  return principal?.kind === 'session' ? principal.user.id : null
}
