import { describe, expect, it } from 'vitest'
import {
  contentPayload,
  contentValue,
  mergeConfirmedContent,
  parsePageDraft,
  parsePostDraft,
  titleSlug,
} from './content-values.ts'
import { toDateTimeLocal } from './datetime.ts'

describe('content editor values', () => {
  it('retains a publication timestamp generated while the author is still typing', () => {
    const stored = '2026-11-26T01:23:45.000Z'
    const submitted = { ...contentValue(), title: ' 初稿 ', excerpt: '  要約  ' }
    const confirmed = {
      ...submitted,
      title: '初稿',
      excerpt: '要約',
      publishedAt: toDateTimeLocal(stored),
    }
    const current = { ...submitted, title: '通信中に追記' }
    const merged = mergeConfirmedContent(submitted, confirmed, current)
    expect(merged.title).toBe('通信中に追記')
    expect(merged.excerpt).toBe('要約')
    expect(contentPayload(merged, stored).publishedAt).toBe(stored)
  })
  it('uses the same editable fallback for Japanese titles and preserves valid generated slugs at the length limit', () => {
    expect(titleSlug('お知らせ', 'post-12345678')).toBe('post-12345678')
    expect(titleSlug(' Édition 旅行 ', 'post-12345678')).toBe('edition')
    expect(titleSlug(`${'a'.repeat(119)} b`, 'post-12345678')).toBe('a'.repeat(119))
    expect(titleSlug('  ', 'post-12345678')).toBe('')
  })

  it('keeps the precision of an unchanged publication date across repeated saves', () => {
    const stored = '2026-11-26T01:23:45.678Z'
    const content = { ...contentValue(), publishedAt: toDateTimeLocal(stored) }
    expect(contentPayload(content, stored).publishedAt).toBe(stored)
    expect(contentPayload({ ...content, publishedAt: '' }, stored).publishedAt).toBeNull()
  })

  it('restores incomplete input, including values that need correction before saving', () => {
    const content = { ...contentValue(), slug: '入力中', manualSlug: true }
    const post = {
      content,
      coverMediaId: 12,
      pinned: true,
      fields: { memo: '下書き' },
      tagIds: [],
      categoryIds: Array.from({ length: 51 }, (_, i) => i + 1),
    }
    expect(parsePostDraft(post)).toEqual(post)
    const page = { content, sortOrder: 4, parentId: 8, templateId: 'richtext', sections: null }
    expect(parsePageDraft(page)).toEqual(page)
    expect(parsePageDraft({ ...page, content: { ...content, bodyJson: {} } })).toBeNull()
    expect(parsePostDraft(page)).toBeNull()
  })
})
