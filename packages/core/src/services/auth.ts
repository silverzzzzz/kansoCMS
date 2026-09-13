import {
  type ApiKeyScope,
  type PublicUser,
  SESSION_TTL_SECONDS,
  type UserRole,
} from '@kanso/shared'
import { count, eq } from 'drizzle-orm'
import { generateToken, hashPassword, sha256Hex, verifyPassword } from '../auth/password.ts'
import type { Db } from '../db/client.ts'
import { apiKeys, sessions, users } from '../db/schema/index.ts'

const API_KEY_PREFIX = 'kanso_'
const API_KEY_TOUCH_INTERVAL_MS = 5 * 60 * 1000

type CreateUserInput = {
  email: string
  password: string
  name: string
  role: UserRole
}

type CreateApiKeyInput = {
  name: string
  scope: ApiKeyScope
}

function toPublicUser(user: {
  id: number
  email: string
  name: string
  role: UserRole
}): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}

export function authService(db: Db) {
  async function countUsers(): Promise<number> {
    const [row] = await db.select({ value: count() }).from(users)
    return row?.value ?? 0
  }

  async function createUser(input: CreateUserInput): Promise<PublicUser> {
    const [user] = await db
      .insert(users)
      .values({
        email: input.email.trim().toLowerCase(),
        passwordHash: await hashPassword(input.password),
        name: input.name,
        role: input.role,
      })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role })

    if (!user) throw new Error('User insert did not return a row')
    return toPublicUser(user)
  }

  async function findUserByEmail(email: string): Promise<PublicUser | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.trim().toLowerCase()),
      columns: { id: true, email: true, name: true, role: true },
    })
    return user ? toPublicUser(user) : null
  }

  async function getUserById(id: number): Promise<PublicUser | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true, email: true, name: true, role: true },
    })
    return user ? toPublicUser(user) : null
  }

  async function verifyCredentials(email: string, password: string): Promise<PublicUser | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.trim().toLowerCase()),
      columns: { id: true, email: true, passwordHash: true, name: true, role: true },
    })
    if (!user || !(await verifyPassword(password, user.passwordHash))) return null
    return toPublicUser(user)
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
    createUser,
    findUserByEmail,
    getUserById,
    verifyCredentials,
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
