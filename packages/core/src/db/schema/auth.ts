import { API_KEY_SCOPES, USER_ROLES } from '@kanso/shared'
import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { timestamps } from './_columns.ts'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: USER_ROLES }).notNull().default('editor'),
  ...timestamps,
})

export const sessions = sqliteTable('sessions', {
  /** SHA-256 of the raw session token. Only the raw token is sent in the cookie. */
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** SHA-256 of the raw key. The raw key is shown once at creation. */
  keyHash: text('key_hash').notNull().unique(),
  scope: text('scope', { enum: API_KEY_SCOPES }).notNull().default('read'),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})
