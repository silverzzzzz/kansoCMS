import type { FormField } from '@kanso/shared'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { timestamps } from './_columns.ts'

/**
 * Field definitions are stored as JSON and validated with a zod schema in
 * @kanso/shared (added in Phase 2). Keeping them in a JSON column avoids a
 * form_fields table for something that is always read as a whole.
 */
export const forms = sqliteTable('forms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  fieldsJson: text('fields_json', { mode: 'json' }).notNull().$type<FormField[]>(),
  /** Comma-separated list of notification recipients. Empty = store only. */
  notifyTo: text('notify_to').notNull().default(''),
  successMessage: text('success_message').notNull().default(''),
  redirectUrl: text('redirect_url'),
  turnstile: integer('turnstile', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
})

export const formSubmissions = sqliteTable(
  'form_submissions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    formId: integer('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    dataJson: text('data_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    /** ip, userAgent, referrer, country — for spam triage, never rendered publicly. */
    metaJson: text('meta_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    readAt: integer('read_at', { mode: 'timestamp' }),
  },
  (t) => [index('form_submissions_form_created_idx').on(t.formId, t.createdAt)],
)
