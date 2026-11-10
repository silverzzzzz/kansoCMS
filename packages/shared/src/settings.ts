import { z } from 'zod'
import { notifyToSchema } from './forms.ts'
import { themeNameSchema } from './themes.ts'

/** Site-wide settings stored as JSON rows in the `settings` table. */
export const siteSettingsSchema = z.object({
  title: z.string().min(1).max(120).default('kansoCMS'),
  description: z.string().max(320).default(''),
  /** BCP 47 language tag used for <html lang> and JSON-LD inLanguage. */
  locale: z.string().min(2).max(35).default('ja'),
  timezone: z.string().default('Asia/Tokyo'),
  logoMediaId: z.number().int().positive().nullable().default(null),
  /** Fallback og:image for pages and archives that do not set their own. */
  ogImageMediaId: z.number().int().positive().nullable().default(null),
  /** Post type shown on `/` when no `home` page exists. */
  homePostTypeSlug: z.string().nullable().default(null),
  /** Emits `noindex, follow` on every public page and empties the sitemap (staging/pre-launch). */
  noindex: z.boolean().default(false),
  /** Favicon from the media library; emits `<link rel="icon">` on every page. */
  faviconMediaId: z.number().int().positive().nullable().default(null),
  /** Content value of `<meta name="google-site-verification">` (Search Console). */
  googleSiteVerification: z.string().trim().max(200).default(''),
  /** Raw HTML injected at the end of `<head>` on every public page (admin-only). */
  headHtml: z.string().max(16_000).nullable().default(null),
  /** Raw HTML injected just before `</body>` on every public page (admin-only). */
  bodyEndHtml: z.string().max(16_000).nullable().default(null),
  /** Extra robots.txt rules appended before the `Sitemap:` line (admin-only). */
  robotsExtra: z.string().max(4096).nullable().default(null),
  /** Published page rendered as the custom 404 body; null = built-in message. */
  notFoundPageId: z.number().int().positive().nullable().default(null),
  /** Maintenance mode: public GETs return 503; signed-in users still see the site. */
  maintenance: z.boolean().default(false),
  /** Message shown on the maintenance page (plain text). */
  maintenanceMessage: z.string().trim().max(500).default(''),
  theme: themeNameSchema.default('default'),
})
export type SiteSettings = z.infer<typeof siteSettingsSchema>

/** Publisher info used for schema.org Organization / WebSite. */
export const organizationSettingsSchema = z.object({
  name: z.string().max(120).default(''),
  url: z.url().nullable().default(null),
  /** Organization logo from the media library; the site logo is the fallback. */
  logoMediaId: z.number().int().positive().nullable().default(null),
  /** X (Twitter) account for `twitter:site`, stored without the leading @. */
  twitterHandle: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9_]{0,15}$/)
    .transform((value) => value.replace(/^@+/, ''))
    .default(''),
  sameAs: z.array(z.url()).default([]),
})
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>

export const formsSettingsSchema = z.object({
  fromEmail: z.union([z.email(), z.literal('')]).default(''),
  fromName: z.string().trim().max(100).default(''),
  notifyTo: notifyToSchema.default(''),
  turnstileSiteKey: z.string().trim().max(200).default(''),
})
export type FormsSettings = z.infer<typeof formsSettingsSchema>

/** Generation token mixed into the public-site cache key; rotated on every content write. */
export const cacheSettingsSchema = z.object({
  version: z.string().min(1).max(64).default('0'),
})
export type CacheSettings = z.infer<typeof cacheSettingsSchema>

/** Theme-specific settings; field-level validation belongs to the theme catalog. */
export const themeSettingsSchema = z.record(z.string(), z.record(z.string(), z.unknown()))
export type ThemeSettings = z.infer<typeof themeSettingsSchema>

export const SETTINGS_KEYS = {
  site: 'site',
  organization: 'organization',
  forms: 'forms',
  cache: 'cache',
  theme: 'theme',
  starter: 'starter',
} as const
