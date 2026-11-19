import { z } from 'zod'
import { richTextDocSchema } from './richtext.ts'

export const CONTENT_STATUSES = ['draft', 'published'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]
export const contentStatusSchema = z.enum(CONTENT_STATUSES)

/** Trashed pages and posts are purged by the daily housekeeping job after this many days. */
export const TRASH_RETENTION_DAYS = 30

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

/**
 * Optional on page and post updates: the `updatedAt` the editor started from.
 * When the item has been saved since (another tab or person), the update is
 * refused with 409 `stale` instead of silently overwriting that save.
 */
export const baseUpdatedAtSchema = z.iso.datetime({ offset: true }).optional()
