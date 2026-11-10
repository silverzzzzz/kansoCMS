import type { RichTextDoc } from '@kanso/shared'

/**
 * Client-side SEO checklist model. Pure functions so the rules can be tested
 * without rendering; thresholds are guidance (目安), never save-blocking.
 */

export type SeoCheckStatus = 'ok' | 'warn'

export type SeoCheck = {
  label: string
  status: SeoCheckStatus
  detail: string
}

export const SEO_TITLE_RANGE = { min: 10, max: 60 } as const
export const SEO_DESCRIPTION_RANGE = { min: 50, max: 160 } as const

export function docHasText(doc: RichTextDoc): boolean {
  const nodes = (doc as { content?: unknown }).content
  if (!Array.isArray(nodes)) return false
  const walk = (list: unknown[]): boolean =>
    list.some((node) => {
      if (node === null || typeof node !== 'object') return false
      const record = node as { text?: unknown; content?: unknown }
      if (typeof record.text === 'string' && record.text.trim() !== '') return true
      return Array.isArray(record.content) && walk(record.content)
    })
  return walk(nodes)
}

export function truncateMiddle(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export function seoChecks(input: {
  title: string
  slug: string
  description: string
  hasOg: boolean
  hasSiteOg: boolean
  hasBody: boolean
}): SeoCheck[] {
  const titleLength = input.title.trim().length
  const descriptionLength = input.description.trim().length
  const inRange = (length: number, { min, max }: { min: number; max: number }) =>
    length >= min && length <= max
  return [
    {
      label: 'タイトル',
      status: inRange(titleLength, SEO_TITLE_RANGE) ? 'ok' : 'warn',
      detail:
        titleLength === 0
          ? `未設定です。${SEO_TITLE_RANGE.min}〜${SEO_TITLE_RANGE.max} 文字が目安`
          : `${titleLength} 文字 (${SEO_TITLE_RANGE.min}〜${SEO_TITLE_RANGE.max} 文字が目安)`,
    },
    {
      label: '説明文',
      status: inRange(descriptionLength, SEO_DESCRIPTION_RANGE) ? 'ok' : 'warn',
      detail:
        descriptionLength === 0
          ? `未設定です。公開時に本文から自動生成されますが、${SEO_DESCRIPTION_RANGE.min}〜${SEO_DESCRIPTION_RANGE.max} 文字の記入がおすすめです`
          : `${descriptionLength} 文字 (${SEO_DESCRIPTION_RANGE.min}〜${SEO_DESCRIPTION_RANGE.max} 文字が目安)`,
    },
    {
      label: 'スラッグ',
      status: input.slug.trim() !== '' ? 'ok' : 'warn',
      detail: input.slug.trim() !== '' ? `/${input.slug}` : '未設定です',
    },
    {
      label: 'OG 画像',
      status: input.hasOg || input.hasSiteOg ? 'ok' : 'warn',
      detail: input.hasOg
        ? 'このコンテンツに設定済み'
        : input.hasSiteOg
          ? 'サイト既定の画像が使われます'
          : '未設定です。SNS 共有時の見た目が不安定になります',
    },
    {
      label: '本文',
      status: input.hasBody ? 'ok' : 'warn',
      detail: input.hasBody ? 'あり' : '本文が空です',
    },
  ]
}

export type SerpModel = {
  siteName: string
  breadcrumb: string
  title: string
  description: string
}

export function serpModel(input: {
  siteName: string
  origin: string
  publicPath: string
  title: string
  description: string
}): SerpModel {
  const host = input.origin.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const segments = input.publicPath
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.')
  return {
    siteName: input.siteName || host,
    breadcrumb: [host, ...segments].join(' › '),
    title: input.title.trim() || '(タイトル未設定)',
    description:
      input.description.trim() || '説明文が未設定です。SEO 説明または抜粋を入力してください。',
  }
}
