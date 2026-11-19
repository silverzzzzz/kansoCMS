import { z } from 'zod'
import { baseUpdatedAtSchema, contentFieldsSchema, seoFieldsSchema } from './content.ts'
import { idSchema, listQuerySchema } from './query.ts'
import { sectionFieldListSchema } from './sections.ts'
import { slugSchema } from './slug.ts'

export const postTypeFieldsSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable(),
  hasCategories: z.boolean(),
  hasTags: z.boolean(),
  /** Applies to archive URLs only; posts keep their own `noindex`. */
  noindex: z.boolean(),
  /** Custom field definitions (Shopify metafields equivalent). */
  fields: sectionFieldListSchema,
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
  /** Sticky posts sort before others in archive lists. */
  pinned: z.boolean(),
  /** Custom field values; validated against the post type's `fields` at write time. */
  fields: z.record(z.string(), z.unknown()),
})

export const createPostSchema = postFieldsSchema
  .partial()
  .required({ postTypeId: true, title: true, slug: true })
export const updatePostSchema = postFieldsSchema
  .partial()
  .omit({ postTypeId: true })
  .extend({ baseUpdatedAt: baseUpdatedAtSchema })
export const postListQuerySchema = listQuerySchema.extend({ type: slugSchema.optional() })

export type CreatePostTypeInput = z.infer<typeof createPostTypeSchema>
export type UpdatePostTypeInput = z.infer<typeof updatePostTypeSchema>
export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>
export type PostListQuery = z.infer<typeof postListQuerySchema>
