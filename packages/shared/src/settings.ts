import { z } from 'zod'

/** Site-wide settings stored as JSON rows in the `settings` table. */
export const siteSettingsSchema = z.object({
  title: z.string().min(1).max(120).default('kansoCMS'),
  description: z.string().max(320).default(''),
  /** BCP 47 language tag used for <html lang> and JSON-LD inLanguage. */
  locale: z.string().min(2).max(35).default('ja'),
  timezone: z.string().default('Asia/Tokyo'),
  logoMediaId: z.number().int().positive().nullable().default(null),
  /** Post type shown on `/` when no `home` page exists. */
  homePostTypeSlug: z.string().nullable().default(null),
})
export type SiteSettings = z.infer<typeof siteSettingsSchema>

/** Publisher info used for schema.org Organization / WebSite. */
export const organizationSettingsSchema = z.object({
  name: z.string().max(120).default(''),
  url: z.url().nullable().default(null),
  logoUrl: z.url().nullable().default(null),
  sameAs: z.array(z.url()).default([]),
})
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>

export const SETTINGS_KEYS = {
  site: 'site',
  organization: 'organization',
} as const
