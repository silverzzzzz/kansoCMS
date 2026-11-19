import { z } from 'zod'
import { baseUpdatedAtSchema, contentFieldsSchema, seoFieldsSchema } from './content.ts'
import { idSchema } from './query.ts'
import { pageSectionsSchema } from './sections.ts'
import { slugSchema } from './slug.ts'

export const pageFieldsSchema = contentFieldsSchema.extend(seoFieldsSchema.shape).extend({
  slug: slugSchema,
  parentId: idSchema.nullable(),
  sortOrder: z.number().int(),
  sections: pageSectionsSchema.nullable(),
})

export const createPageSchema = pageFieldsSchema.partial().required({ title: true, slug: true })
export const updatePageSchema = pageFieldsSchema
  .partial()
  .extend({ baseUpdatedAt: baseUpdatedAtSchema })

export type CreatePageInput = z.infer<typeof createPageSchema>
export type UpdatePageInput = z.infer<typeof updatePageSchema>
