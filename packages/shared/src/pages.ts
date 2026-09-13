import { z } from 'zod'
import { contentFieldsSchema, seoFieldsSchema } from './content.ts'
import { idSchema } from './query.ts'
import { slugSchema } from './slug.ts'

export const pageFieldsSchema = contentFieldsSchema.extend(seoFieldsSchema.shape).extend({
  slug: slugSchema,
  parentId: idSchema.nullable(),
  sortOrder: z.number().int(),
})

export const createPageSchema = pageFieldsSchema.partial().required({ title: true, slug: true })
export const updatePageSchema = pageFieldsSchema.partial()

export type CreatePageInput = z.infer<typeof createPageSchema>
export type UpdatePageInput = z.infer<typeof updatePageSchema>
