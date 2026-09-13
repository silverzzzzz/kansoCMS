import { z } from 'zod'
import { API_KEY_SCOPES, USER_ROLES } from './content.ts'

export const passwordSchema = z.string().min(8).max(256)

export const setupSchema = z.object({
  email: z.email(),
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
  siteTitle: z.string().trim().min(1).max(120).optional(),
})

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

export const publicUserSchema = z.object({
  id: z.number().int(),
  email: z.email(),
  name: z.string(),
  role: z.enum(USER_ROLES),
})
export type PublicUser = z.infer<typeof publicUserSchema>

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(API_KEY_SCOPES),
})

export const SESSION_COOKIE = 'kanso_session'
export const API_KEY_HEADER = 'x-api-key'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
