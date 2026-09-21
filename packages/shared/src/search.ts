import { z } from 'zod'

export const SEARCH_PER_PAGE = 10

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(SEARCH_PER_PAGE),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>
export type SearchHitKind = 'page' | 'post'
export type SnippetSegment = { text: string; hit: boolean }
