import { and, desc, eq } from 'drizzle-orm'
import { generateToken, sha256Hex } from '../auth/encoding.ts'
import type { Db } from '../db/client.ts'
import { type ShareLinkTargetType, shareLinks } from '../db/schema/index.ts'
import { KansoError } from '../errors.ts'

/** Fixed lifetime of an issued preview link: 7 days. */
export const SHARE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function shareLinksService(db: Db) {
  /** Issue a link. The raw token is returned once and never stored. */
  async function create(input: {
    targetType: ShareLinkTargetType
    targetId: number
    createdBy: number | null
  }) {
    const token = generateToken()
    const expiresAt = new Date(Date.now() + SHARE_LINK_TTL_MS)
    const id = await sha256Hex(token)
    await db.insert(shareLinks).values({
      id,
      targetType: input.targetType,
      targetId: input.targetId,
      createdBy: input.createdBy,
      expiresAt,
    })
    return { id, token, expiresAt }
  }

  async function listFor(targetType: ShareLinkTargetType, targetId: number) {
    return db.query.shareLinks.findMany({
      where: and(eq(shareLinks.targetType, targetType), eq(shareLinks.targetId, targetId)),
      orderBy: [desc(shareLinks.createdAt)],
    })
  }

  async function revoke(id: string) {
    const removed = await db
      .delete(shareLinks)
      .where(eq(shareLinks.id, id))
      .returning({ id: shareLinks.id })
    if (removed.length === 0) throw KansoError.notFound('Share link')
  }

  /** Resolve a raw token to its target; expired or unknown links 404. */
  async function resolve(token: string) {
    const link = await db.query.shareLinks.findFirst({
      where: eq(shareLinks.id, await sha256Hex(token)),
    })
    if (!link || link.expiresAt.getTime() <= Date.now()) {
      throw KansoError.notFound('Share link')
    }
    return { targetType: link.targetType, targetId: link.targetId }
  }

  /** Batch statement removing every link that points at a purged target. */
  function deleteForTargetStatement(targetType: ShareLinkTargetType, targetId: number) {
    return db
      .delete(shareLinks)
      .where(and(eq(shareLinks.targetType, targetType), eq(shareLinks.targetId, targetId)))
  }

  return { create, listFor, revoke, resolve, deleteForTargetStatement }
}

export type ShareLinksService = ReturnType<typeof shareLinksService>
