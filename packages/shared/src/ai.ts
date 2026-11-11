import { z } from 'zod'

export const AI_SUGGEST_KINDS = ['excerpt', 'description'] as const
export type AiSuggestKind = (typeof AI_SUGGEST_KINDS)[number]

/** BCP-47 tag (e.g. `ja`, `en`); defaults to Japanese prompts. */
const localeSchema = z.string().trim().min(2).max(20).optional()

export const aiSuggestSchema = z.object({
  kind: z.enum(AI_SUGGEST_KINDS),
  /** Body text the excerpt or description is written from. */
  text: z.string().trim().min(1).max(20000),
  locale: localeSchema,
})

export type AiSuggestInput = z.infer<typeof aiSuggestSchema>

/** Raster formats the vision model reads; other media get no alt suggestion. */
export const AI_ALT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
/** Largest image handed to the model (it travels base64-encoded in the request). */
export const AI_ALT_MAX_BYTES = 4 * 1024 * 1024

export function supportsAiAlt(mime: string): boolean {
  return (AI_ALT_MIME_TYPES as readonly string[]).includes(mime)
}

/** Alt text is written from the image itself, so the request names the media row. */
export const aiAltSchema = z.object({
  mediaId: z.number().int().positive(),
  locale: localeSchema,
})

export type AiAltInput = z.infer<typeof aiAltSchema>
