import { z } from 'zod'
import { contentFieldsSchema, seoFieldsSchema } from './content.ts'
import { idSchema, listQuerySchema } from './query.ts'
import { slugSchema } from './slug.ts'

export const postTypeFieldsSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable(),
  hasCategories: z.boolean(),
  hasTags: z.boolean(),
  sortOrder: z.number().int(),
})

export const createPostTypeSchema = postTypeFieldsSchema
  .partial()
  .required({ slug: true, name: true })
export const updatePostTypeSchema = postTypeFieldsSchema.partial()

export const postFieldsSchema = contentFieldsSchema.extend(seoFieldsSchema.shape).extend({
  postTypeId: idSchema,
  slug: slugSchema,
  coverMediaId: idSchema.nullable(),
  categoryIds: z.array(idSchema).max(50),
  tagIds: z.array(idSchema).max(50),
})

export const createPostSchema = postFieldsSchema
  .partial()
  .required({ postTypeId: true, title: true, slug: true })
export const updatePostSchema = postFieldsSchema.partial().omit({ postTypeId: true })
export const postListQuerySchema = listQuerySchema.extend({ type: slugSchema.optional() })

export type CreatePostTypeInput = z.infer<typeof createPostTypeSchema>
export type UpdatePostTypeInput = z.infer<typeof updatePostTypeSchema>
export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>
export type PostListQuery = z.infer<typeof postListQuerySchema>
