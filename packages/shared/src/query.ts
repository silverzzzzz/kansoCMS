import { z } from 'zod'

/** `scheduled` is a virtual status: published content whose publishedAt is still in the future. */
export const listStatusSchema = z.enum(['draft', 'published', 'scheduled'])

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
  status: listStatusSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  /** `true` lists trashed rows instead of live ones. */
  trashed: z.enum(['true', 'false']).optional(),
})
export type ListQuery = z.infer<typeof listQuerySchema>

export const idSchema = z.coerce.number().int().positive()
