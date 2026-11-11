import { zValidator } from '@hono/zod-validator'
import { KansoError } from '@kanso/core'
import { type AiSuggestInput, aiAltSchema, aiSuggestSchema, canSuggestAlt } from '@kanso/shared'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { aiBinding } from '../bindings.ts'
import type { AppEnv } from '../env.ts'
import { validationHook } from './validate.ts'

const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct'
/** Multimodal and multilingual; reads the image as a base64 data URI. */
const VISION_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'
const ALT_MAX_LENGTH = 500

type Language = 'ja' | 'en'

/**
 * Fixed server-side prompts keep the model on a single deterministic task.
 * `ja` prompts request Japanese output; everything else uses English.
 */
const PROMPTS: Record<AiSuggestInput['kind'], Record<Language, string>> = {
  excerpt: {
    ja: '以下の本文を、日本語120字以内の抜粋にまとめてください。前置きや引用符は付けず、抜粋文だけを出力してください。',
    en: 'Summarize the following body text into an excerpt of at most 160 characters. Output only the excerpt.',
  },
  description: {
    ja: '以下の本文の検索結果向けメタ説明文（description）を、日本語160字以内で書いてください。前置きや引用符は付けず、説明文だけを出力してください。',
    en: 'Write a meta description of at most 160 characters for the following body text. Output only the description.',
  },
}

const ALT_PROMPT: Record<Language, string> = {
  ja: 'この画像の代替テキスト（alt）を日本語で書いてください。画像に写っているものだけを、80字以内の1文で具体的に説明します。「画像」「写真」で始めず、前置きや引用符も付けず、alt 文だけを出力してください。',
  en: 'Write alt text for this image: one specific sentence of at most 125 characters describing only what is visible. Do not start with "Image of" or "Photo of". Output only the alt text.',
}

function language(locale: string | undefined): Language {
  return (locale ?? 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

function unavailable(c: Context<AppEnv>) {
  return c.json({ error: { code: 'unavailable', message: 'AI is not configured' } }, 503)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

/** Models sometimes wrap the answer in quotes or add line breaks; alt text is one plain line. */
function cleanAlt(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .slice(0, ALT_MAX_LENGTH)
}

export const ai = new Hono<AppEnv>()
  /** Whether the optional AI binding is configured; the admin hides its buttons when not. */
  .get('/', (c) => c.json({ available: aiBinding(c.env) !== undefined }))
  .post('/suggest', zValidator('json', aiSuggestSchema, validationHook), async (c) => {
    const binding = aiBinding(c.env)
    if (!binding) return unavailable(c)
    const { kind, text, locale } = c.req.valid('json')
    const result = (await binding.run(TEXT_MODEL, {
      messages: [
        { role: 'system', content: PROMPTS[kind][language(locale)] },
        { role: 'user', content: text.slice(0, 8000) },
      ],
      max_tokens: 256,
    })) as { response?: string }
    const suggested = result.response?.trim() ?? ''
    if (!suggested) throw new KansoError('internal', 'AI returned an empty response')
    return c.json({ text: suggested })
  })
  /**
   * Alt text written from the image itself: the stored object is read from R2
   * and handed to a vision model. (A file name says nothing about a picture.)
   */
  .post('/alt', zValidator('json', aiAltSchema, validationHook), async (c) => {
    const binding = aiBinding(c.env)
    if (!binding) return unavailable(c)
    const { mediaId, locale } = c.req.valid('json')
    const item = await c.var.kanso.media.get(mediaId)
    if (!canSuggestAlt(item)) {
      throw KansoError.validation('This file cannot be described (unsupported type or too large)')
    }
    // A stored variant is plenty for a description and far lighter than the
    // original: the smallest one at least 960px wide, else the largest there is.
    const variants = [...item.variants].sort((a, b) => a.width - b.width)
    const variant = variants.find((candidate) => candidate.width >= 960) ?? variants.at(-1)
    const key = (variant?.url ?? item.url).slice(1)
    const mime = variant ? (key.endsWith('.webp') ? 'image/webp' : 'image/jpeg') : item.mime
    const object = await c.env.MEDIA.get(key)
    if (!object) throw KansoError.notFound('Media')
    const image = toBase64(new Uint8Array(await object.arrayBuffer()))

    const result = (await binding.run(VISION_MODEL, {
      messages: [
        { role: 'system', content: ALT_PROMPT[language(locale)] },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } }],
        },
      ],
      max_tokens: 128,
    })) as { response?: string }
    const suggested = cleanAlt(result.response ?? '')
    if (!suggested) throw new KansoError('internal', 'AI returned an empty response')
    return c.json({ text: suggested })
  })
