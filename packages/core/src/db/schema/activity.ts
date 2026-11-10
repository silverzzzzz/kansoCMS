import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './auth.ts'

/**
 * Who changed what and when (T58). `actor` is a display string kept verbatim
 * so the log still reads sensibly after the user or API key is removed;
 * `userId` links the session user when there is one.
 */
export const activityLog = sqliteTable(
  'activity_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Display name: user name, `api-key:<name>`, or `system`. */
    actor: text('actor').notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** create / update / trash / restore / purge / delete / import / login / … */
    action: text('action').notNull(),
    /** page / post / post_type / category / tag / media / form / menu / settings / redirect / starter / api_key / passkey / auth / import. */
    targetType: text('target_type').notNull(),
    /** Row id or slug serialized to text; null for bulk/global actions. */
    targetId: text('target_id'),
    summary: text('summary').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('activity_log_created_idx').on(t.createdAt, t.id)],
)
