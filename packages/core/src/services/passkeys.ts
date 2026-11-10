import {
  type AuthenticationCredential,
  PASSKEY_CHALLENGE_TTL_SECONDS,
  PASSKEY_LIMIT,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
  type PasskeySummary,
  type PublicUser,
  type RegistrationCredential,
  type SetupInput,
  setupSchema,
  slugify,
} from '@kanso/shared'
import { and, asc, count, eq, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { generateToken, randomHex, sha256Hex } from '../auth/encoding.ts'
import {
  creationOptions,
  type ExpectedCeremony,
  type RelyingParty,
  readChallenge,
  requestOptions,
  type VerifiedRegistration,
  verifyAuthentication,
  verifyRegistration,
} from '../auth/webauthn.ts'
import type { Db } from '../db/client.ts'
import {
  authChallenges,
  type PasskeyChallengePurpose,
  passkeyLinks,
  passkeys,
  users,
} from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'
import { toPublicUser } from './auth.ts'

export type { RelyingParty } from '../auth/webauthn.ts'

const DEFAULT_PASSKEY_NAME = 'パスキー'

const setupChallengeSchema = setupSchema.extend({ webauthnUserId: z.string().min(1) })
const linkChallengeSchema = z.object({ linkId: z.string().min(1) })

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  slug: users.slug,
  role: users.role,
  webauthnUserId: users.webauthnUserId,
}

function expected(rp: RelyingParty, challenge: string): ExpectedCeremony {
  return { challenge, rpId: rp.id, origin: rp.origin }
}

function toSummary(row: {
  id: number
  name: string
  backedUp: boolean
  createdAt: Date
  lastUsedAt: Date | null
}): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }
}

/**
 * The `insert ... select` columns of a passkey after `id, user_id`, in table
 * definition order (drizzle inserts into every column for a SQL select).
 */
function passkeyColumns(verified: VerifiedRegistration, name: string) {
  return sql`${verified.credentialId}, ${verified.publicKey}, ${verified.algorithm},
    ${verified.signCount}, ${JSON.stringify(verified.transports)}, ${verified.backedUp ? 1 : 0},
    ${name}, unixepoch(), null`
}

export function passkeyService(db: Db) {
  async function issueChallenge(
    purpose: PasskeyChallengePurpose,
    options: { userId?: number; data?: Record<string, unknown> } = {},
  ): Promise<string> {
    const challenge = generateToken()
    const now = new Date()
    // Expired challenges are swept here so abandoned ceremonies do not pile up.
    await db.batch([
      db.delete(authChallenges).where(lt(authChallenges.expiresAt, now)),
      db.insert(authChallenges).values({
        id: challenge,
        purpose,
        userId: options.userId ?? null,
        data: options.data ?? null,
        expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000),
      }),
    ])
    return challenge
  }

  /** Takes the challenge a response answers out of the store (single use). */
  async function consumeChallenge(clientDataJSON: string, purpose: PasskeyChallengePurpose) {
    const challenge = readChallenge(clientDataJSON)
    const [row] = await db
      .delete(authChallenges)
      .where(eq(authChallenges.id, challenge))
      .returning()
    if (!row || row.purpose !== purpose || row.expiresAt.getTime() <= Date.now()) {
      throw KansoError.unauthorized('Passkey challenge is invalid or has expired')
    }
    return row
  }

  async function credentialsOf(userId: number) {
    return db
      .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
  }

  async function userById(userId: number) {
    const [user] = await db.select(userColumns).from(users).where(eq(users.id, userId)).limit(1)
    if (!user) throw KansoError.notFound('User')
    return user
  }

  /** Users created before passkeys get a handle in migration 0006; this is a safety net. */
  async function handleOf(user: { id: number; webauthnUserId: string | null }): Promise<string> {
    if (user.webauthnUserId) return user.webauthnUserId
    const webauthnUserId = randomHex(16)
    await db.update(users).set({ webauthnUserId }).where(eq(users.id, user.id))
    return webauthnUserId
  }

  async function setupOptions(
    input: SetupInput,
    rp: RelyingParty,
  ): Promise<PasskeyCreationOptions> {
    const [row] = await db.select({ value: count() }).from(users)
    if ((row?.value ?? 0) > 0) throw KansoError.conflict('Setup has already been completed')

    const webauthnUserId = randomHex(16)
    const email = input.email.trim().toLowerCase()
    const challenge = await issueChallenge('setup', {
      data: { ...input, email, webauthnUserId },
    })
    return creationOptions({
      rp,
      user: { webauthnUserId, email, name: input.name },
      challenge,
      exclude: [],
    })
  }

  /**
   * Creates the first admin and their passkey in one transaction. Only the
   * setup that wins creates a user (`where not exists`), and the passkey is
   * attached through this setup's own user handle, never to another user.
   */
  async function finishSetup(
    credential: RegistrationCredential,
    rp: RelyingParty,
    passkeyName?: string,
  ): Promise<{ user: PublicUser; setup: SetupInput }> {
    const row = await consumeChallenge(credential.response.clientDataJSON, 'setup')
    const parsed = setupChallengeSchema.safeParse(row.data)
    if (!parsed.success) throw KansoError.unauthorized('Passkey challenge is invalid')
    const verified = await verifyRegistration(credential, expected(rp, row.id))
    const { webauthnUserId, ...setup } = parsed.data

    const authorSlug = slugify(setup.name) || 'user'
    const [, , created] = await db.batch([
      // Positional values follow the table column order exactly.
      db.insert(users).select(
        sql`select null, ${setup.email}, ${setup.name}, 'admin', ${webauthnUserId},
            ${authorSlug}, null, null, unixepoch(), unixepoch()
            where not exists (select 1 from ${users})`,
      ),
      db.insert(passkeys).select(
        sql`select null, u.id, ${passkeyColumns(verified, passkeyName ?? DEFAULT_PASSKEY_NAME)}
            from ${users} u where u.webauthn_user_id = ${webauthnUserId}`,
      ),
      db.select(userColumns).from(users).where(eq(users.webauthnUserId, webauthnUserId)),
    ])
    const user = created[0]
    if (!user) throw KansoError.conflict('Setup has already been completed')
    return { user: toPublicUser(user), setup }
  }

  async function loginOptions(rp: RelyingParty): Promise<PasskeyRequestOptions> {
    return requestOptions({ rpId: rp.id, challenge: await issueChallenge('login') })
  }

  async function finishLogin(
    credential: AuthenticationCredential,
    rp: RelyingParty,
  ): Promise<PublicUser> {
    const row = await consumeChallenge(credential.response.clientDataJSON, 'login')
    const [found] = await db
      .select({
        passkey: {
          id: passkeys.id,
          credentialId: passkeys.credentialId,
          publicKey: passkeys.publicKey,
          algorithm: passkeys.algorithm,
          signCount: passkeys.signCount,
        },
        user: userColumns,
      })
      .from(passkeys)
      .innerJoin(users, eq(passkeys.userId, users.id))
      .where(eq(passkeys.credentialId, credential.id))
      .limit(1)
    if (!found) throw KansoError.unauthorized('This passkey is not registered')

    const result = await verifyAuthentication(
      credential,
      { ...expected(rp, row.id), webauthnUserId: await handleOf(found.user) },
      found.passkey,
    )
    await db
      .update(passkeys)
      .set({ signCount: result.signCount, backedUp: result.backedUp, lastUsedAt: new Date() })
      .where(eq(passkeys.id, found.passkey.id))
    return toPublicUser(found.user)
  }

  async function list(userId: number): Promise<PasskeySummary[]> {
    const rows = await db
      .select({
        id: passkeys.id,
        name: passkeys.name,
        backedUp: passkeys.backedUp,
        createdAt: passkeys.createdAt,
        lastUsedAt: passkeys.lastUsedAt,
      })
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt), asc(passkeys.id))
    return rows.map(toSummary)
  }

  async function registerOptions(userId: number, rp: RelyingParty) {
    const user = await userById(userId)
    const existing = await credentialsOf(userId)
    if (existing.length >= PASSKEY_LIMIT) {
      throw KansoError.conflict(`A user can register up to ${PASSKEY_LIMIT} passkeys`)
    }
    const challenge = await issueChallenge('register', { userId })
    return creationOptions({
      rp,
      user: { webauthnUserId: await handleOf(user), email: user.email, name: user.name },
      challenge,
      exclude: existing,
    })
  }

  async function insertPasskey(userId: number, verified: VerifiedRegistration, name: string) {
    try {
      const [created] = await db
        .insert(passkeys)
        .values({
          userId,
          credentialId: verified.credentialId,
          publicKey: verified.publicKey,
          algorithm: verified.algorithm,
          signCount: verified.signCount,
          transports: verified.transports,
          backedUp: verified.backedUp,
          name,
        })
        .returning()
      if (!created) throw new Error('Passkey insert did not return a row')
      return toSummary(created)
    } catch (error) {
      if (isUniqueViolation(error)) throw KansoError.conflict('This passkey is already registered')
      throw error
    }
  }

  async function finishRegister(
    userId: number,
    credential: RegistrationCredential,
    rp: RelyingParty,
    name?: string,
  ): Promise<PasskeySummary> {
    const row = await consumeChallenge(credential.response.clientDataJSON, 'register')
    if (row.userId !== userId) throw KansoError.unauthorized('Passkey challenge is invalid')
    const verified = await verifyRegistration(credential, expected(rp, row.id))
    if ((await credentialsOf(userId)).length >= PASSKEY_LIMIT) {
      throw KansoError.conflict(`A user can register up to ${PASSKEY_LIMIT} passkeys`)
    }
    return insertPasskey(userId, verified, name ?? DEFAULT_PASSKEY_NAME)
  }

  async function rename(userId: number, id: number, name: string): Promise<PasskeySummary> {
    const [updated] = await db
      .update(passkeys)
      .set({ name })
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
      .returning()
    if (!updated) throw KansoError.notFound('Passkey')
    return toSummary(updated)
  }

  /** Deletes one of the user's passkeys, but never the last one (in one statement). */
  async function remove(userId: number, id: number): Promise<void> {
    const deleted = await db
      .delete(passkeys)
      .where(
        and(
          eq(passkeys.id, id),
          eq(passkeys.userId, userId),
          sql`(select count(*) from ${passkeys} where ${passkeys.userId} = ${userId}) > 1`,
        ),
      )
      .returning({ id: passkeys.id })
    if (deleted.length > 0) return

    const [exists] = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
    if (!exists) throw KansoError.notFound('Passkey')
    throw KansoError.conflict('The last passkey cannot be removed')
  }

  async function findLink(token: string) {
    const [found] = await db
      .select({
        link: { id: passkeyLinks.id, expiresAt: passkeyLinks.expiresAt },
        user: userColumns,
      })
      .from(passkeyLinks)
      .innerJoin(users, eq(passkeyLinks.userId, users.id))
      .where(eq(passkeyLinks.id, await sha256Hex(token)))
      .limit(1)
    if (!found || found.link.expiresAt.getTime() <= Date.now()) {
      throw KansoError.notFound('Passkey link')
    }
    return found
  }

  async function linkOptions(token: string, rp: RelyingParty) {
    const { link, user } = await findLink(token)
    const challenge = await issueChallenge('link', { userId: user.id, data: { linkId: link.id } })
    return {
      options: creationOptions({
        rp,
        user: { webauthnUserId: await handleOf(user), email: user.email, name: user.name },
        challenge,
        exclude: await credentialsOf(user.id),
      }),
      user: { email: user.email, name: user.name },
    }
  }

  /**
   * Registers a passkey through a one-time link and consumes the link in the
   * same transaction. The passkey limit is not enforced: the link exists to
   * recover an account whose passkeys are all lost.
   */
  async function finishLink(
    token: string,
    credential: RegistrationCredential,
    rp: RelyingParty,
    passkeyName?: string,
  ): Promise<PublicUser> {
    const { link, user } = await findLink(token)
    const row = await consumeChallenge(credential.response.clientDataJSON, 'link')
    const data = linkChallengeSchema.safeParse(row.data)
    if (row.userId !== user.id || !data.success || data.data.linkId !== link.id) {
      throw KansoError.unauthorized('Passkey challenge is invalid')
    }
    const verified = await verifyRegistration(credential, expected(rp, row.id))

    try {
      const [inserted] = await db.batch([
        db
          .insert(passkeys)
          .select(
            sql`select null, l.user_id, ${passkeyColumns(verified, passkeyName ?? DEFAULT_PASSKEY_NAME)}
              from ${passkeyLinks} l where l.id = ${link.id} and l.expires_at > unixepoch()`,
          )
          .returning({ id: passkeys.id }),
        db.delete(passkeyLinks).where(eq(passkeyLinks.id, link.id)),
      ])
      // Another request used the link first.
      if (inserted.length === 0) throw KansoError.notFound('Passkey link')
    } catch (error) {
      if (isUniqueViolation(error)) throw KansoError.conflict('This passkey is already registered')
      throw error
    }
    return toPublicUser(user)
  }

  return {
    setupOptions,
    finishSetup,
    loginOptions,
    finishLogin,
    list,
    registerOptions,
    finishRegister,
    rename,
    remove,
    linkOptions,
    finishLink,
  }
}

export type PasskeyService = ReturnType<typeof passkeyService>
