import {
  type ContentStatus,
  pageSectionsSchema,
  postFieldsSchema,
  type RichTextDoc,
  richTextDocSchema,
  SLUG_PATTERN,
  slugify,
} from '@kanso/shared'
import { ApiError, fieldErrors } from '../api/errors.ts'
import type { PostItem } from '../api/queries.ts'
import { fromDateTimeLocal, toDateTimeLocal } from './datetime.ts'

export type ContentFormValue = {
  title: string
  slug: string
  manualSlug: boolean
  status: ContentStatus
  publishedAt: string
  bodyJson: RichTextDoc
  excerpt: string
  seoTitle: string
  seoDescription: string
  ogMediaId: number | null
  noindex: boolean
  canonicalUrl: string
}

type ServerContent = Pick<PostItem, Exclude<keyof ContentFormValue, 'manualSlug'>>
export function contentValue(item?: ServerContent): ContentFormValue {
  return {
    title: item?.title ?? '',
    slug: item?.slug ?? '',
    manualSlug: Boolean(item),
    status: item?.status ?? 'draft',
    publishedAt: toDateTimeLocal(item?.publishedAt ?? null),
    // ProseMirror requires an editable paragraph even in a blank document.
    bodyJson: item?.bodyJson ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    excerpt: item?.excerpt ?? '',
    seoTitle: item?.seoTitle ?? '',
    seoDescription: item?.seoDescription ?? '',
    ogMediaId: item?.ogMediaId ?? null,
    noindex: item?.noindex ?? false,
    canonicalUrl: item?.canonicalUrl ?? '',
  }
}

export function titleSlug(title: string, fallback: string) {
  return title.trim() ? slugify(title).replace(/-+$/, '') || fallback : ''
}

/** Adopt server-generated dates and trimmed text without replacing edits made during the request. */
export function mergeConfirmedContent(
  submitted: ContentFormValue,
  confirmed: ContentFormValue,
  current: ContentFormValue,
): ContentFormValue {
  const next = { ...current }
  for (const key of [
    'publishedAt',
    'title',
    'excerpt',
    'seoTitle',
    'seoDescription',
    'canonicalUrl',
  ] as const) {
    if (current[key] === submitted[key]) next[key] = confirmed[key]
  }
  return next
}

export function contentPayload(value: ContentFormValue, storedTime: string | null) {
  const { manualSlug: _manual, ...content } = value
  return {
    ...content,
    publishedAt:
      value.publishedAt === toDateTimeLocal(storedTime)
        ? storedTime
        : fromDateTimeLocal(value.publishedAt),
    excerpt: value.excerpt.trim() || null,
    seoTitle: value.seoTitle.trim() || null,
    seoDescription: value.seoDescription.trim() || null,
    canonicalUrl: value.canonicalUrl.trim() || null,
  }
}

export function validateContent(value: ContentFormValue) {
  const issues: { path: string; message: string }[] = []
  if (!value.title.trim()) issues.push({ path: 'title', message: 'タイトルを入力してください。' })
  if (!SLUG_PATTERN.test(value.slug) || value.slug.length > 120) {
    issues.push({
      path: 'slug',
      message:
        'スラッグには半角英小文字・数字を使い、単語の間はハイフンで区切ってください（120文字以内）。',
    })
  }
  if (value.canonicalUrl.trim() && !URL.canParse(value.canonicalUrl.trim())) {
    issues.push({ path: 'canonicalUrl', message: 'https:// などで始まる URL を入力してください。' })
  }
  if (issues.length) throw new ApiError(422, 'input', '入力内容を確認してください。', issues)
}

export function contentErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  switch (error.message) {
    case 'Post slug already exists in this post type':
    case 'Page path already exists':
    case 'Slug is used by a post type':
      return { slug: 'この URL は使用されています。別のスラッグを入力してください。' }
    case 'Page slug is reserved':
      return { slug: 'このスラッグはシステムが使用します。別のスラッグを入力してください。' }
    case 'Parent page does not exist':
      return { parentId: '選んだ親ページが見つかりません。親ページを選び直してください。' }
    case 'Page cannot be its own ancestor':
      return { parentId: 'このページや子ページを親ページにはできません。' }
  }
  const fields = fieldErrors(error)
  if (error.message === 'Invalid custom fields') {
    return Object.fromEntries(
      Object.keys(fields).map((key) => [`fields.${key}`, '入力内容を確認してください。']),
    )
  }
  return fields
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isContentValue(value: unknown): value is ContentFormValue {
  if (!record(value)) return false
  const strings = [
    'title',
    'slug',
    'publishedAt',
    'excerpt',
    'seoTitle',
    'seoDescription',
    'canonicalUrl',
  ]
  return (
    strings.every((key) => typeof value[key] === 'string') &&
    (value.status === 'draft' || value.status === 'published') &&
    typeof value.manualSlug === 'boolean' &&
    typeof value.noindex === 'boolean' &&
    (value.ogMediaId === null || Number.isSafeInteger(value.ogMediaId)) &&
    richTextDocSchema.safeParse(value.bodyJson).success
  )
}

export type PageDraft = {
  content: ContentFormValue
  parentId: number | null
  sortOrder: number
  templateId: string
  sections: ReturnType<typeof pageSectionsSchema.parse> | null
}

export function parsePageDraft(value: unknown): PageDraft | null {
  if (
    !record(value) ||
    !isContentValue(value.content) ||
    typeof value.sortOrder !== 'number' ||
    typeof value.templateId !== 'string' ||
    !(value.parentId === null || typeof value.parentId === 'number')
  )
    return null
  const sections = pageSectionsSchema.nullable().safeParse(value.sections)
  return sections.success
    ? {
        content: value.content,
        sortOrder: value.sortOrder,
        templateId: value.templateId,
        parentId: value.parentId,
        sections: sections.data,
      }
    : null
}

const postMetadata = postFieldsSchema
  .pick({
    coverMediaId: true,
    pinned: true,
    fields: true,
    categoryIds: true,
    tagIds: true,
  })
  .extend({
    // A draft may exceed the server's 50-item limit while the author corrects it.
    categoryIds: postFieldsSchema.shape.categoryIds.element.array(),
    tagIds: postFieldsSchema.shape.tagIds.element.array(),
  })
export type PostDraft = { content: ContentFormValue } & ReturnType<typeof postMetadata.parse>

export function parsePostDraft(value: unknown): PostDraft | null {
  if (!record(value) || !isContentValue(value.content)) return null
  const meta = postMetadata.safeParse(value)
  return meta.success ? { content: value.content, ...meta.data } : null
}
