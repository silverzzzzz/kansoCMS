import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './auth.ts'

export const SHARE_LINK_TARGET_TYPES = ['page', 'post'] as const
export type ShareLinkTargetType = (typeof SHARE_LINK_TARGET_TYPES)[number]

/**
 * Login-free draft preview links. Only the token's SHA-256 is stored; the
 * plaintext token lives solely in the issued URL (same pattern as
 * passkey_links). The target is polymorphic, so there is no FK to
 * pages/posts — purging content deletes its links explicitly.
 */
export const shareLinks = sqliteTable(
  'share_links',
  {
    /** SHA-256 hex of the raw token. */
    id: text('id').primaryKey(),
    targetType: text('target_type', { enum: SHARE_LINK_TARGET_TYPES }).notNull(),
    targetId: integer('target_id').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('share_links_target_idx').on(t.targetType, t.targetId)],
)
