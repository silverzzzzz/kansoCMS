import { z } from 'zod'

export const AI_SUGGEST_KINDS = ['excerpt', 'description', 'alt'] as const
export type AiSuggestKind = (typeof AI_SUGGEST_KINDS)[number]

export const aiSuggestSchema = z.object({
  kind: z.enum(AI_SUGGEST_KINDS),
  /** Source material: body text for excerpt/description, filename+context for alt. */
  text: z.string().trim().min(1).max(20000),
  /** BCP-47 tag (e.g. `ja`, `en`); defaults to Japanese prompts. */
  locale: z.string().trim().min(2).max(20).optional(),
})

export type AiSuggestInput = z.infer<typeof aiSuggestSchema>
