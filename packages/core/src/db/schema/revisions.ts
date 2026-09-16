import {
  type PageRevisionSnapshot,
  type PostRevisionSnapshot,
  REVISION_TARGETS,
} from '@kanso/shared'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './auth.ts'

export const revisions = sqliteTable(
  'revisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    targetType: text('target_type', { enum: REVISION_TARGETS }).notNull(),
    targetId: integer('target_id').notNull(),
    snapshotJson: text('snapshot_json', { mode: 'json' })
      .notNull()
      .$type<PageRevisionSnapshot | PostRevisionSnapshot>(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('revisions_target_idx').on(t.targetType, t.targetId, t.createdAt)],
)
