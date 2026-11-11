import {
  type InviteUserInput,
  slugify,
  type UpdateUserInput,
  USER_INVITE_TTL_SECONDS,
} from '@kanso/shared'
import { and, asc, count, eq, gt, or, type SQL, sql } from 'drizzle-orm'
import { generateToken, randomHex, sha256Hex } from '../auth/encoding.ts'
import type { Db } from '../db/client.ts'
import { passkeyLinks, passkeys, posts, users } from '../db/schema/index.ts'
import { startsWith } from '../db/search.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'

/**
 * User management for administrators: invite, change role, re-issue a
 * registration link, remove. Sign-in itself lives in `passkeys.ts`; an
 * invitation is simply a user row without passkeys plus a one-time
 * registration link (the same link the recovery CLI issues).
 */
export function usersService(db: Db) {
  /**
   * "Another administrator who can sign in exists" as SQL, so the check and
   * the write are one statement. An administrator who was invited but has not
   * registered a passkey yet does not count: with only them left, nobody could
   * reach the settings or issue them a new link.
   */
  const anotherAdminCanSignIn = (userId: number) =>
    sql`exists (
      select 1 from users other
      where other.role = 'admin' and other.id <> ${userId}
        and exists (select 1 from passkeys where passkeys.user_id = other.id)
    )`

  async function get(id: number) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        slug: users.slug,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (!user) throw KansoError.notFound('User')
    return user
  }

  /** Everyone who can sign in or has been invited, with what they need to do next. */
  async function list() {
    const now = new Date()
    const [rows, passkeyCounts, pendingLinks] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          slug: users.slug,
          role: users.role,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(asc(users.id)),
      db
        .select({ userId: passkeys.userId, value: count() })
        .from(passkeys)
        .groupBy(passkeys.userId),
      db
        .select({
          userId: passkeyLinks.userId,
          expiresAt: sql`max(${passkeyLinks.expiresAt})`.mapWith(passkeyLinks.expiresAt),
        })
        .from(passkeyLinks)
        .where(gt(passkeyLinks.expiresAt, now))
        .groupBy(passkeyLinks.userId),
    ])
    const passkeysOf = new Map(passkeyCounts.map((row) => [row.userId, row.value]))
    const linkOf = new Map(pendingLinks.map((row) => [row.userId, row.expiresAt]))
    return rows.map((row) => ({
      ...row,
      passkeys: passkeysOf.get(row.id) ?? 0,
      /** Expiry of an unused registration link, if one is outstanding. */
      linkExpiresAt: linkOf.get(row.id) ?? null,
    }))
  }

  /** A free author slug derived from the name: `hana`, `hana-2`, … */
  async function freeSlug(name: string): Promise<string> {
    const base = slugify(name) || 'user'
    const taken = new Set(
      (
        await db
          .select({ slug: users.slug })
          .from(users)
          .where(or(eq(users.slug, base), startsWith(users.slug, `${base}-`)))
      ).map((row) => row.slug),
    )
    if (!taken.has(base)) return base
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const candidate = `${base.slice(0, 110)}-${suffix}`
      if (!taken.has(candidate)) return candidate
    }
    return `${base.slice(0, 100)}-${randomHex(4)}`
  }

  /**
   * A fresh registration link for `userId`. Older links of the same user stop
   * working: the administrator is handing over exactly one.
   */
  async function linkStatements(userRef: number | SQL, ttlSeconds: number) {
    const token = generateToken()
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    const id = await sha256Hex(token)
    return {
      token,
      expiresAt,
      statements: [
        db.delete(passkeyLinks).where(eq(passkeyLinks.userId, userRef)),
        db.insert(passkeyLinks).values({ id, userId: userRef, expiresAt }),
      ] as const,
    }
  }

  /** Create a user who has no passkey yet, together with the link that lets them add one. */
  async function invite(input: InviteUserInput) {
    const email = input.email.trim().toLowerCase()
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    })
    if (existing) throw KansoError.conflict('A user with this email address already exists')

    const slug = await freeSlug(input.name)
    const link = await linkStatements(
      sql`(select id from users where email = ${email})`,
      USER_INVITE_TTL_SECONDS,
    )
    try {
      const [created] = await db.batch([
        db
          .insert(users)
          .values({ email, name: input.name, role: input.role, slug })
          .returning({ id: users.id }),
        ...link.statements,
      ])
      const id = created[0]?.id
      if (id === undefined) throw new Error('User insert did not return a row')
      return { user: await get(id), token: link.token, expiresAt: link.expiresAt }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw KansoError.conflict('A user with this email address already exists')
      }
      throw error
    }
  }

  async function issueLink(id: number, ttlSeconds = USER_INVITE_TTL_SECONDS) {
    const user = await get(id)
    const link = await linkStatements(id, ttlSeconds)
    await db.batch([...link.statements])
    return { user, token: link.token, expiresAt: link.expiresAt }
  }

  async function update(id: number, input: UpdateUserInput) {
    const current = await get(id)
    const values: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) values.name = input.name
    if (input.role !== undefined) values.role = input.role

    // Demoting the last administrator would lock everyone out of the settings.
    const demotes = current.role === 'admin' && input.role === 'editor'
    const updated = await db
      .update(users)
      .set(values)
      .where(demotes ? and(eq(users.id, id), anotherAdminCanSignIn(id)) : eq(users.id, id))
      .returning({ id: users.id })
    if (updated.length === 0) {
      throw KansoError.conflict('No other administrator can sign in')
    }
    return get(id)
  }

  /**
   * Remove a user. Sessions, passkeys and links go with the row (FK cascade);
   * their posts stay, either handed to `reassignTo` or left without an author.
   */
  async function remove(id: number, options: { actorId: number; reassignTo?: number }) {
    if (id === options.actorId) throw KansoError.validation('You cannot remove your own account')
    const current = await get(id)
    if (options.reassignTo !== undefined) {
      if (options.reassignTo === id) {
        throw KansoError.validation('Posts cannot be handed to the user being removed')
      }
      await get(options.reassignTo)
    }

    const [, removed] = await db.batch([
      db
        .update(posts)
        .set({ authorId: options.reassignTo ?? null })
        .where(
          and(
            eq(posts.authorId, id),
            // Only when the delete below is going to happen.
            current.role === 'admin' ? anotherAdminCanSignIn(id) : sql`1 = 1`,
          ),
        ),
      db
        .delete(users)
        .where(
          current.role === 'admin'
            ? and(eq(users.id, id), anotherAdminCanSignIn(id))
            : eq(users.id, id),
        )
        .returning({ id: users.id }),
    ])
    if (removed.length === 0) {
      throw KansoError.conflict('No other administrator can sign in')
    }
    return current
  }

  return { list, get, invite, issueLink, update, remove }
}

export type UsersService = ReturnType<typeof usersService>
