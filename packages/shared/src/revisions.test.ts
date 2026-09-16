import { describe, expect, it } from 'vitest'
import { pageRevisionSnapshotSchema, postRevisionSnapshotSchema } from './revisions.ts'

const content = {
  title: 'Before update',
  slug: 'before-update',
  bodyJson: { type: 'doc' as const, content: [] },
  excerpt: null,
  status: 'draft' as const,
  publishedAt: null,
  seoTitle: null,
  seoDescription: null,
  ogMediaId: null,
  noindex: false,
  canonicalUrl: null,
}

describe('revision snapshot schemas', () => {
  it('round-trips page and post snapshots', () => {
    const page = { ...content, parentId: null, sortOrder: 0 }
    const post = { ...content, coverMediaId: null, categoryIds: [1], tagIds: [2] }

    expect(pageRevisionSnapshotSchema.parse(page)).toEqual(page)
    expect(postRevisionSnapshotSchema.parse(post)).toEqual(post)
  })

  it('rejects snapshots without a title', () => {
    const { title: _title, ...pageWithoutTitle } = {
      ...content,
      parentId: null,
      sortOrder: 0,
    }
    const { title: _postTitle, ...postWithoutTitle } = {
      ...content,
      coverMediaId: null,
      categoryIds: [],
      tagIds: [],
    }

    expect(pageRevisionSnapshotSchema.safeParse(pageWithoutTitle).success).toBe(false)
    expect(postRevisionSnapshotSchema.safeParse(postWithoutTitle).success).toBe(false)
  })
})
