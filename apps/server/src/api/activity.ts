import { zValidator } from '@hono/zod-validator'
import type { ActivityEntry } from '@kanso/core'
import { activityListQuerySchema } from '@kanso/shared'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import type { Principal } from '../middleware/auth.ts'
import { validationHook } from './validate.ts'

function actorOf(principal: Principal | undefined): { actor: string; userId: number | null } {
  if (principal?.kind === 'session') {
    return { actor: principal.user.name || principal.user.email, userId: principal.user.id }
  }
  if (principal?.kind === 'apiKey')
    return { actor: `api-key:${principal.apiKey.name}`, userId: null }
  return { actor: 'system', userId: null }
}

/**
 * Record one mutation in the activity log. Logging failures are swallowed —
 * an audit write must never break the mutation it describes.
 */
export async function logActivity(
  c: Context<AppEnv>,
  entry: Omit<ActivityEntry, 'actor' | 'userId'> & { actor?: string; userId?: number | null },
): Promise<void> {
  try {
    const { actor, userId, ...rest } = entry
    const fallback = actorOf(c.var.principal)
    await c.var.kanso.activity.log({
      actor: actor ?? fallback.actor,
      userId: userId === undefined ? fallback.userId : userId,
      ...rest,
    })
  } catch {
    // Best-effort audit trail.
  }
}

export const activity = new Hono<AppEnv>().get(
  '/',
  zValidator('query', activityListQuerySchema, validationHook),
  async (c) => {
    const limit = c.req.valid('query').limit ?? 100
    return c.json({ items: await c.var.kanso.activity.list(limit) })
  },
)
