import { z } from 'zod'
import { idSchema } from './query.ts'
import { themeNameSchema } from './themes.ts'

export const starterManifestSchema = z.object({
  installedAt: z.iso.datetime(),
  pages: z.array(idSchema),
  posts: z.array(idSchema),
  postTypes: z.array(idSchema),
  categories: z.array(idSchema),
  tags: z.array(idSchema),
  forms: z.array(idSchema),
  media: z.array(idSchema),
  themeSettings: z
    .object({ theme: themeNameSchema, values: z.record(z.string(), z.unknown()) })
    .nullable(),
  siteDescription: z.string().nullable(),
})
export type StarterManifest = z.infer<typeof starterManifestSchema>
