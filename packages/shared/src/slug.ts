import { z } from 'zod'

/**
 * Top-level path segments owned by the system. Neither a page path nor a
 * post type slug may claim these.
 */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'media',
  'preview',
  'search',
  'sitemap.xml',
  'robots.txt',
  'feed.xml',
] as const

// biome-ignore lint/complexity/noUselessEscapeInRegex: `.source` feeds HTML `pattern` attributes, which browsers compile with the `v` flag (unescaped `-` is a syntax error there)
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?$/

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(SLUG_PATTERN, 'Use lowercase letters, digits and hyphens only')

// Combining marks (accents etc.), stripped after NFKD decomposition.
const COMBINING_MARKS = /\p{M}/gu

/** Best-effort slugify for admin UI defaults. Server still validates. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug)
}
