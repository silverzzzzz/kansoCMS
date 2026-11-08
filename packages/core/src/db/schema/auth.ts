import { API_KEY_SCOPES, USER_ROLES } from '@kanso/shared'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { randomHex } from '../../auth/encoding.ts'
import { timestamps } from './_columns.ts'

export const PASSKEY_CHALLENGE_PURPOSES = ['setup', 'login', 'register', 'link'] as const
export type PasskeyChallengePurpose = (typeof PASSKEY_CHALLENGE_PURPOSES)[number]

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: USER_ROLES }).notNull().default('editor'),
  /**
   * Opaque WebAuthn user handle (32 hex chars). Nullable only because SQLite
   * cannot add a NOT NULL column to a populated table; every row has one
   * (migration 0006 fills existing users, inserts generate it).
   */
  webauthnUserId: text('webauthn_user_id')
    .unique()
    .$defaultFn(() => randomHex(16)),
  ...timestamps,
})

export const passkeys = sqliteTable(
  'passkeys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** base64url credential id as the browser reports it. */
    credentialId: text('credential_id').notNull().unique(),
    /** SubjectPublicKeyInfo (DER), base64url. */
    publicKey: text('public_key').notNull(),
    /** COSE algorithm: -7 (ES256) or -257 (RS256). */
    algorithm: integer('algorithm').notNull(),
    signCount: integer('sign_count').notNull().default(0),
    transports: text('transports_json', { mode: 'json' }).notNull().$type<string[]>(),
    /** Synced passkey (backup state flag), shown in the account screen. */
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull().default(false),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
)

/** Single-use WebAuthn challenges, consumed by `delete ... returning`. */
export const authChallenges = sqliteTable('auth_challenges', {
  /** The challenge itself (base64url of 32 random bytes). */
  id: text('id').primaryKey(),
  purpose: text('purpose', { enum: PASSKEY_CHALLENGE_PURPOSES }).notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  data: text('data_json', { mode: 'json' }).$type<Record<string, unknown>>(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
})

/**
 * One-time links that let a user register a passkey without signing in
 * (recovery via `pnpm passkey:link`). Only the token's SHA-256 is stored.
 */
export const passkeyLinks = sqliteTable('passkey_links', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
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
