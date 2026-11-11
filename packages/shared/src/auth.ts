import { z } from 'zod'
import { API_KEY_SCOPES, USER_ROLES } from './content.ts'
import { slugSchema } from './slug.ts'

const base64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, 'Expected base64url')

/** First step of setup: who the first admin is. The passkey is created next. */
export const setupSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100),
  siteTitle: z.string().trim().min(1).max(120).optional(),
  /** Install the starter site right after creating the first admin. */
  starter: z.boolean().optional(),
})
export type SetupInput = z.infer<typeof setupSchema>

export const passkeyNameSchema = z.string().trim().min(1).max(100)

/** `PublicKeyCredential.toJSON()` of a `navigator.credentials.create()` result. */
export const registrationCredentialSchema = z.object({
  id: base64url(1400),
  rawId: base64url(1400),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: base64url(8192),
    attestationObject: base64url(32768),
    transports: z.array(z.string().max(32)).max(10).optional(),
  }),
  authenticatorAttachment: z.string().max(32).nullable().optional(),
})
export type RegistrationCredential = z.infer<typeof registrationCredentialSchema>

/** `PublicKeyCredential.toJSON()` of a `navigator.credentials.get()` result. */
export const authenticationCredentialSchema = z.object({
  id: base64url(1400),
  rawId: base64url(1400),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: base64url(8192),
    authenticatorData: base64url(8192),
    signature: base64url(1024),
    userHandle: base64url(128).nullable().optional(),
  }),
  authenticatorAttachment: z.string().max(32).nullable().optional(),
})
export type AuthenticationCredential = z.infer<typeof authenticationCredentialSchema>

export const finishSetupSchema = z.object({
  credential: registrationCredentialSchema,
  passkeyName: passkeyNameSchema.optional(),
})

export const passkeyLoginSchema = z.object({ credential: authenticationCredentialSchema })

export const addPasskeySchema = z.object({
  credential: registrationCredentialSchema,
  name: passkeyNameSchema.optional(),
})

export const renamePasskeySchema = z.object({ name: passkeyNameSchema })

export const passkeyLinkSchema = z.object({ token: base64url(128) })

export const finishPasskeyLinkSchema = passkeyLinkSchema.extend({
  credential: registrationCredentialSchema,
  passkeyName: passkeyNameSchema.optional(),
})

/** JSON form of `PublicKeyCredentialCreationOptions` (binary fields as base64url). */
export type PasskeyCreationOptions = {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  timeout: number
  attestation: 'none'
  authenticatorSelection: {
    residentKey: 'required'
    requireResidentKey: true
    userVerification: 'required'
  }
  excludeCredentials: { type: 'public-key'; id: string; transports?: string[] }[]
}

/** JSON form of `PublicKeyCredentialRequestOptions` (binary fields as base64url). */
export type PasskeyRequestOptions = {
  challenge: string
  rpId: string
  timeout: number
  userVerification: 'required'
  allowCredentials: { type: 'public-key'; id: string; transports?: string[] }[]
}

export type PasskeySummary = {
  id: number
  name: string
  backedUp: boolean
  createdAt: string
  lastUsedAt: string | null
}

export const PASSKEY_LIMIT = 10
export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60
export const PASSKEY_LINK_TTL_SECONDS = 60 * 60

export const publicUserSchema = z.object({
  id: z.number().int(),
  email: z.email(),
  name: z.string(),
  slug: z.string().nullable(),
  role: z.enum(USER_ROLES),
})
export type PublicUser = z.infer<typeof publicUserSchema>

/** Self-service author profile: slug, bio and avatar (account screen). */
export const updateProfileSchema = z.object({
  slug: slugSchema.optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  avatarMediaId: z.number().int().nullable().optional(),
})
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

/**
 * How long an invitation (or a re-issued registration link) stays valid.
 * Longer than the recovery CLI's hour: the invitee may not act the same day.
 */
export const USER_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60

const userNameSchema = z.string().trim().min(1).max(100)

/** An administrator adds a user; the user then registers a passkey through a one-time link. */
export const inviteUserSchema = z.object({
  email: z.email().max(254),
  name: userNameSchema,
  role: z.enum(USER_ROLES).default('editor'),
})
export type InviteUserInput = z.infer<typeof inviteUserSchema>

export const updateUserSchema = z.object({
  name: userNameSchema.optional(),
  role: z.enum(USER_ROLES).optional(),
})
export type UpdateUserInput = z.infer<typeof updateUserSchema>

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(API_KEY_SCOPES),
})

export const SESSION_COOKIE = 'kanso_session'
export const API_KEY_HEADER = 'x-api-key'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
