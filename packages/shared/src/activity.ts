import { z } from 'zod'

export const ACTIVITY_QUERY_MAX_LIMIT = 200

export const activityListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(ACTIVITY_QUERY_MAX_LIMIT).optional(),
})

export type ActivityListQuery = z.infer<typeof activityListQuerySchema>
