import { z } from 'zod'
import { richTextDocSchema } from './richtext.ts'

export const CONTENT_STATUSES = ['draft', 'published'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]
export const contentStatusSchema = z.enum(CONTENT_STATUSES)

export const USER_ROLES = ['admin', 'editor'] as const
export type UserRole = (typeof USER_ROLES)[number]
export const userRoleSchema = z.enum(USER_ROLES)

export const API_KEY_SCOPES = ['read', 'write'] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]
export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES)

/** SEO fields shared by pages and posts. */
export const seoFieldsSchema = z.object({
  seoTitle: z.string().trim().max(120).nullable(),
  seoDescription: z.string().trim().max(320).nullable(),
  ogMediaId: z.number().int().positive().nullable(),
  noindex: z.boolean(),
  canonicalUrl: z.url().nullable(),
})
export type SeoFields = z.infer<typeof seoFieldsSchema>

export const contentFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyJson: richTextDocSchema,
  excerpt: z.string().trim().max(500).nullable(),
  status: contentStatusSchema,
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
})
