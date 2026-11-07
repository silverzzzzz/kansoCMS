import { z } from 'zod'
import { idSchema } from './query.ts'
import { themeNameSchema } from './themes.ts'

/**
 * What the starter site installed, stored under `settings.starter`. Removal
 * only ever touches what is listed here.
 */
export const starterManifestSchema = z.object({
  installedAt: z.iso.datetime(),
  pages: z.array(idSchema),
  posts: z.array(idSchema),
  postTypes: z.array(idSchema),
  categories: z.array(idSchema),
  tags: z.array(idSchema),
  forms: z.array(idSchema),
  media: z.array(idSchema),
  // What install wrote into settings, so removal can revert only untouched values.
  themeSettings: z
    .object({ theme: themeNameSchema, values: z.record(z.string(), z.unknown()) })
    .nullable(),
  siteDescription: z.string().nullable(),
})
export type StarterManifest = z.infer<typeof starterManifestSchema>

export const STARTER_ITEM_KINDS = [
  'pages',
  'posts',
  'postTypes',
  'categories',
  'tags',
  'forms',
  'media',
] as const
export type StarterItemKind = (typeof STARTER_ITEM_KINDS)[number]
export type StarterCounts = Record<StarterItemKind, number>

export function starterCounts(manifest: Pick<StarterManifest, StarterItemKind>): StarterCounts {
  return {
    pages: manifest.pages.length,
    posts: manifest.posts.length,
    postTypes: manifest.postTypes.length,
    categories: manifest.categories.length,
    tags: manifest.tags.length,
    forms: manifest.forms.length,
    media: manifest.media.length,
  }
}

/** Why removal left a starter item in place. */
export const STARTER_KEPT_REASONS = ['edited', 'in_use', 'has_children', 'has_submissions'] as const
export type StarterKeptReason = (typeof STARTER_KEPT_REASONS)[number]
