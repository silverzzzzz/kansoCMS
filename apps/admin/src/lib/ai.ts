import type { AiSuggestKind, RichTextDoc } from '@kanso/shared'
import { api } from '../api/client.ts'
import { unwrap } from '../api/request.ts'

/** Flatten a rich-text document into plain text for AI source material. */
export function docToText(doc: RichTextDoc): string {
  const parts: string[] = []
  const walk = (node: unknown) => {
    if (node === null || typeof node !== 'object') return
    const record = node as { text?: unknown; content?: unknown }
    if (typeof record.text === 'string' && record.text.trim() !== '') parts.push(record.text)
    if (Array.isArray(record.content)) record.content.forEach(walk)
  }
  walk(doc)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export async function suggestAi(kind: AiSuggestKind, text: string): Promise<{ text: string }> {
  const result = await unwrap(api.ai.suggest.$post({ json: { kind, text } }))
  return result as { text: string }
}
