import { z } from 'zod'
import { idSchema } from './query.ts'
import { slugSchema } from './slug.ts'

export const categoryFieldsSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  parentId: idSchema.nullable(),
  sortOrder: z.number().int(),
})
export const createCategorySchema = categoryFieldsSchema
  .partial()
  .required({ slug: true, name: true })
export const updateCategorySchema = categoryFieldsSchema.partial()

export const tagFieldsSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
})
export const createTagSchema = tagFieldsSchema.partial().required({ slug: true, name: true })
export const updateTagSchema = tagFieldsSchema.partial()

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
export type CreateTagInput = z.infer<typeof createTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>
