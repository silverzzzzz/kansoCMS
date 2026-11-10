import {
  type ApiKeyScope,
  mediaUrl,
  type PublicUser,
  SESSION_TTL_SECONDS,
  type UpdateProfileInput,
  type UserRole,
} from '@kanso/shared'
import { and, count, eq, ne } from 'drizzle-orm'
import { generateToken, sha256Hex } from '../auth/encoding.ts'
import type { Db } from '../db/client.ts'
import { apiKeys, media, sessions, users } from '../db/schema/index.ts'
import { KansoError } from '../errors.ts'
import { assertMediaExists } from './media.ts'

const API_KEY_PREFIX = 'kanso_'
const API_KEY_TOUCH_INTERVAL_MS = 5 * 60 * 1000

type CreateApiKeyInput = {
  name: string
  scope: ApiKeyScope
}

export function toPublicUser(user: {
  id: number
  email: string
  name: string
  slug: string | null
  role: UserRole
}): PublicUser {
  return { id: user.id, email: user.email, name: user.name, slug: user.slug, role: user.role }
}

export function authService(db: Db) {
  async function countUsers(): Promise<number> {
    const [row] = await db.select({ value: count() }).from(users)
    return row?.value ?? 0
  }

  async function findUserByEmail(email: string): Promise<PublicUser | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.trim().toLowerCase()),
      columns: { id: true, email: true, name: true, slug: true, role: true },
    })
    return user ? toPublicUser(user) : null
  }

  async function getUserById(id: number): Promise<PublicUser | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true, email: true, name: true, slug: true, role: true },
    })
    return user ? toPublicUser(user) : null
  }

  /** The editable author profile fields (account screen). */
  async function getProfile(userId: number) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { slug: true, bio: true, avatarMediaId: true },
    })
    if (!user) throw KansoError.notFound('User')
    return user
  }

  async function updateProfile(userId: number, input: UpdateProfileInput) {
    if (input.slug !== undefined) {
      const duplicate = await db.query.users.findFirst({
        where: and(eq(users.slug, input.slug), ne(users.id, userId)),
        columns: { id: true },
      })
      if (duplicate) throw KansoError.conflict('Author slug already exists')
    }
    await assertMediaExists(db, input.avatarMediaId)
    const values: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
    if (input.slug !== undefined) values.slug = input.slug
    if (input.bio !== undefined) values.bio = input.bio?.trim() ? input.bio : null
    if (input.avatarMediaId !== undefined) values.avatarMediaId = input.avatarMediaId
    await db.update(users).set(values).where(eq(users.id, userId))
    return getProfile(userId)
  }

  /** Public author identity for `/{type}/author/{slug}` archives. */
  async function findAuthorBySlug(slug: string) {
    const user = await db.query.users.findFirst({
      where: eq(users.slug, slug),
      columns: { id: true, name: true, slug: true, bio: true, avatarMediaId: true },
    })
    if (!user) return null
    const avatar = user.avatarMediaId
      ? await db.query.media.findFirst({
          where: eq(media.id, user.avatarMediaId),
          columns: { r2Key: true, alt: true, width: true, height: true },
        })
      : null
    return {
      id: user.id,
      name: user.name,
      slug: user.slug,
      bio: user.bio,
      avatar: avatar ? { url: mediaUrl(avatar.r2Key), alt: avatar.alt } : null,
    }
  }

  async function createSession(userId: number) {
    const token = generateToken()
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
    await db.insert(sessions).values({ id: await sha256Hex(token), userId, expiresAt })
    return { token, expiresAt }
  }

  async function getSessionUser(token: string): Promise<PublicUser | null> {
    const sessionId = await sha256Hex(token)
    const [row] = await db
      .select({
        expiresAt: sessions.expiresAt,
        id: users.id,
        email: users.email,
        name: users.name,
        slug: users.slug,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId))
      .limit(1)

    if (!row) return null
    if (row.expiresAt.getTime() <= Date.now()) {
      await db.delete(sessions).where(eq(sessions.id, sessionId))
      return null
    }
    return toPublicUser(row)
  }

  async function deleteSession(token: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)))
  }

  async function deleteUserSessions(userId: number): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId))
  }

  async function createApiKey(input: CreateApiKeyInput) {
    const key = API_KEY_PREFIX + generateToken()
    const [apiKey] = await db
      .insert(apiKeys)
      .values({ name: input.name, scope: input.scope, keyHash: await sha256Hex(key) })
      .returning({ id: apiKeys.id, name: apiKeys.name, scope: apiKeys.scope })

    if (!apiKey) throw new Error('API key insert did not return a row')
    return { ...apiKey, key }
  }

  async function verifyApiKey(key: string) {
    const apiKey = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.keyHash, await sha256Hex(key)),
      columns: { id: true, name: true, scope: true, lastUsedAt: true },
    })
    if (!apiKey) return null

    const now = new Date()
    if (
      !apiKey.lastUsedAt ||
      now.getTime() - apiKey.lastUsedAt.getTime() >= API_KEY_TOUCH_INTERVAL_MS
    ) {
      await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, apiKey.id))
    }
    return { id: apiKey.id, name: apiKey.name, scope: apiKey.scope }
  }

  async function listApiKeys() {
    return db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        scope: apiKeys.scope,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
  }

  async function deleteApiKey(id: number): Promise<void> {
    await db.delete(apiKeys).where(eq(apiKeys.id, id))
  }

  return {
    countUsers,
    findUserByEmail,
    getUserById,
    getProfile,
    updateProfile,
    findAuthorBySlug,
    createSession,
    getSessionUser,
    deleteSession,
    deleteUserSessions,
    createApiKey,
    verifyApiKey,
    listApiKeys,
    deleteApiKey,
  }
}

export type AuthService = ReturnType<typeof authService>
