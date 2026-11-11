import { createRedirectSchema } from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestKanso, type TestKanso } from '../testing/index.ts'

const context = { allowRawHtml: false }

describe('trash and purge', () => {
  let test: TestKanso

  beforeEach(() => {
    test = createTestKanso()
  })
  afterEach(() => test.close())

  async function page(slug: string, parentId: number | null = null) {
    return test.kanso.pages.create({ title: slug, slug, parentId, status: 'published' }, context)
  }

  it('trashes a page with its descendants even when the path exceeds 50 bytes', async () => {
    // D1 caps LIKE patterns at 50 bytes; the cascade used `path like '<path>/%'`.
    const parent = await page(`section-${'with-a-very-long-slug-'.repeat(3)}end`)
    const child = await page('child', parent.id)
    const grandchild = await page('grandchild', child.id)
    const sibling = await page(`${parent.slug}-sibling`)

    await test.kanso.pages.delete(parent.id)

    const trashed = await test.kanso.pages.list({ trashed: 'true' })
    expect(trashed.items.map((item) => item.id).sort()).toEqual(
      [parent.id, child.id, grandchild.id].sort(),
    )
    await expect(test.kanso.pages.get(sibling.id)).resolves.toMatchObject({ id: sibling.id })
  })

  it('keeps a trashed page when the delete is repeated without force', async () => {
    const item = await page('retry-me')
    await test.kanso.pages.delete(item.id)
    await test.kanso.pages.delete(item.id) // a retry or a double click

    const trashed = await test.kanso.pages.list({ trashed: 'true' })
    expect(trashed.items.map((row) => row.id)).toEqual([item.id])
    await expect(test.kanso.pages.restore(item.id)).resolves.toMatchObject({ id: item.id })
  })

  it('purges a page only with force', async () => {
    const item = await page('purge-me')
    await test.kanso.pages.delete(item.id)
    await test.kanso.pages.delete(item.id, { force: true })

    const trashed = await test.kanso.pages.list({ trashed: 'true' })
    expect(trashed.items).toEqual([])
  })

  it('applies the same rules to posts', async () => {
    const type = await test.kanso.postTypes.create({ slug: 'news', name: 'News' })
    const post = await test.kanso.posts.create(
      { postTypeId: type.id, slug: 'hello', title: 'Hello', status: 'published' },
      { ...context, authorId: null },
    )
    await test.kanso.posts.delete(post.id)
    await test.kanso.posts.delete(post.id)
    expect((await test.kanso.posts.list({ trashed: 'true' })).items.map((row) => row.id)).toEqual([
      post.id,
    ])

    await test.kanso.posts.delete(post.id, { force: true })
    expect((await test.kanso.posts.list({ trashed: 'true' })).items).toEqual([])
  })
})

describe('list search', () => {
  let test: TestKanso

  beforeEach(() => {
    test = createTestKanso()
  })
  afterEach(() => test.close())

  // 21 Japanese characters = 63 bytes, over D1's 50-byte LIKE pattern limit.
  const long = 'お問い合わせフォームの送信完了ページについて'

  it('finds pages and posts by a long Japanese title fragment', async () => {
    const created = await test.kanso.pages.create(
      { title: `${long}のご案内`, slug: 'thanks', status: 'draft' },
      context,
    )
    await test.kanso.pages.create({ title: 'Other', slug: 'other', status: 'draft' }, context)
    const type = await test.kanso.postTypes.create({ slug: 'news', name: 'News' })
    const post = await test.kanso.posts.create(
      { postTypeId: type.id, slug: 'thanks', title: `${long} (記事)`, status: 'draft' },
      { ...context, authorId: null },
    )

    expect((await test.kanso.pages.list({ q: long })).items.map((item) => item.id)).toEqual([
      created.id,
    ])
    expect((await test.kanso.posts.list({ q: long })).items.map((item) => item.id)).toEqual([
      post.id,
    ])
  })

  it('matches ASCII case-insensitively and treats % and _ literally', async () => {
    await test.kanso.pages.create(
      { title: 'About 100% Kanso_CMS', slug: 'a', status: 'draft' },
      context,
    )
    await test.kanso.pages.create(
      { title: 'About 100 percent', slug: 'b', status: 'draft' },
      context,
    )

    expect((await test.kanso.pages.list({ q: 'kanso_cms' })).total).toBe(1)
    expect((await test.kanso.pages.list({ q: '100%' })).total).toBe(1)
    expect((await test.kanso.pages.list({ q: 'ABOUT' })).total).toBe(2)
  })

  it('searches tags and redirects with a long query', async () => {
    await test.kanso.taxonomies.createTag({ slug: 'thanks', name: long })
    await test.kanso.redirects.create(
      createRedirectSchema.parse({ fromPath: '/old', to: '/new', status: 301 }),
    )

    expect((await test.kanso.taxonomies.listTags(long)).map((tag) => tag.slug)).toEqual(['thanks'])
    expect(await test.kanso.redirects.list(long)).toEqual([])
    expect((await test.kanso.redirects.list('OLD')).length).toBe(1)
  })
})

describe('redirect CSV import', () => {
  it('imports 500 rows in a handful of queries', async () => {
    const test = createTestKanso()
    // The API validates (and normalises) input with the shared schema before the service.
    await test.kanso.redirects.create(
      createRedirectSchema.parse({ fromPath: '/from-3', to: '/before', status: 302 }),
    )
    const csv = Array.from({ length: 500 }, (_, index) => `/from-${index},/to-${index},301`).join(
      '\n',
    )

    test.resetQueries()
    const result = await test.kanso.redirects.importRows(csv)

    expect(result).toMatchObject({ created: 499, updated: 1, errors: [], truncated: false })
    expect(test.queries()).toBeLessThanOrEqual(8)
    const updated = await test.kanso.redirects.findByPath('from-3')
    expect(updated).toMatchObject({ to: '/to-3', status: 301 })
    test.close()
  })
})
