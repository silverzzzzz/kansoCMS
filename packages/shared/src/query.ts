import { z } from 'zod'
import { contentStatusSchema } from './content.ts'

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
  status: contentStatusSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
})
export type ListQuery = z.infer<typeof listQuerySchema>

export const idSchema = z.coerce.number().int().positive()
