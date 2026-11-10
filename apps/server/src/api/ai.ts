import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { type AiSuggestInput, aiSuggestSchema } from '@kanso/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { validationHook } from './validate.ts'

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct'

/**
 * Fixed server-side prompts keep the model on a single deterministic task.
 * `ja` prompts request Japanese output; everything else uses English.
 */
const PROMPTS: Record<AiSuggestInput['kind'], { ja: string; en: string }> = {
  excerpt: {
    ja: '以下の本文を、日本語120字以内の抜粋にまとめてください。前置きや引用符は付けず、抜粋文だけを出力してください。',
    en: 'Summarize the following body text into an excerpt of at most 160 characters. Output only the excerpt.',
  },
  description: {
    ja: '以下の本文の検索結果向けメタ説明文（description）を、日本語160字以内で書いてください。前置きや引用符は付けず、説明文だけを出力してください。',
    en: 'Write a meta description of at most 160 characters for the following body text. Output only the description.',
  },
  alt: {
    ja: '以下は画像ファイルのファイル名と掲載コンテキストです。この画像の代替テキスト（alt）を、日本語で簡潔に書いてください。前置きや引用符は付けず、alt 文だけを出力してください。',
    en: 'The following is an image filename and its publishing context. Write a concise alt text for the image. Output only the alt text.',
  },
}

export const ai = new Hono<AppEnv>().post(
  '/suggest',
  zValidator('json', aiSuggestSchema, validationHook),
  async (c) => {
    if (!c.env.AI) {
      return c.json({ error: { code: 'unavailable', message: 'AI is not configured' } }, 503)
    }
    const { kind, text, locale } = c.req.valid('json')
    const ja = (locale ?? 'ja').toLowerCase().startsWith('ja')
    const result = (await c.env.AI.run(AI_MODEL, {
      messages: [
        { role: 'system', content: PROMPTS[kind][ja ? 'ja' : 'en'] },
        { role: 'user', content: text.slice(0, 8000) },
      ],
      max_tokens: 256,
    })) as { response?: string }
    const suggested = result.response?.trim() ?? ''
    if (!suggested) throw new KansoError('internal', 'AI returned an empty response')
    return c.json({ text: suggested })
  },
)
