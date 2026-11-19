import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KansoError } from '../errors.ts'
import { createTestKanso, type TestKanso } from '../testing/index.ts'

const context = { allowRawHtml: false, userId: null }

/**
 * `baseUpdatedAt` on page and post updates: an editor that loaded an older
 * version cannot silently overwrite a save made since.
 */
describe('stale saves', () => {
  let test: TestKanso
  const nowSeconds = Math.floor(Date.now() / 1000)
  // What the first editor loaded: a version from a minute ago.
  const loadedAt = new Date((nowSeconds - 60) * 1000).toISOString()

  beforeEach(() => {
    test = createTestKanso()
  })
  afterEach(() => test.close())

  async function stalePageError(run: () => Promise<unknown>) {
    const error = await run().then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(KansoError)
    return error as KansoError
  }

  it('refuses a page update that started from an older version', async () => {
    const page = await test.kanso.pages.create({ title: 'About', slug: 'about' }, context)
    test.exec(`update pages set updated_at = ${nowSeconds - 60} where id = ${page.id}`)

    // Someone else saves first (no base: an API client or another tab).
    await test.kanso.pages.update(page.id, { title: 'About us' }, context)

    const error = await stalePageError(() =>
      test.kanso.pages.update(page.id, { title: 'About me', baseUpdatedAt: loadedAt }, context),
    )
    expect(error.code).toBe('stale')
    expect((await test.kanso.pages.get(page.id)).title).toBe('About us')
  })

  it('accepts a page update from the current version, at second precision', async () => {
    const page = await test.kanso.pages.create({ title: 'About', slug: 'about' }, context)
    test.exec(`update pages set updated_at = ${nowSeconds - 60} where id = ${page.id}`)
    const current = (await test.kanso.pages.get(page.id)).updatedAt
    // A client may send milliseconds; the stored value has none.
    const base = new Date(current.getTime() + 999).toISOString()

    const updated = await test.kanso.pages.update(
      page.id,
      { title: 'About us', baseUpdatedAt: base },
      context,
    )
    expect(updated.title).toBe('About us')
  })

  it('does not check without a base, so API clients behave as before', async () => {
    const page = await test.kanso.pages.create({ title: 'About', slug: 'about' }, context)
    test.exec(`update pages set updated_at = ${nowSeconds - 60} where id = ${page.id}`)
    await test.kanso.pages.update(page.id, { title: 'Second' }, context)
    const updated = await test.kanso.pages.update(page.id, { title: 'Third' }, context)
    expect(updated.title).toBe('Third')
  })

  it('refuses a post update that started from an older version', async () => {
    const type = await test.kanso.postTypes.create({ slug: 'news', name: 'News' })
    const post = await test.kanso.posts.create(
      { postTypeId: type.id, slug: 'hello', title: 'Hello' },
      { ...context, authorId: null },
    )
    test.exec(`update posts set updated_at = ${nowSeconds - 60} where id = ${post.id}`)
    await test.kanso.posts.update(post.id, { title: 'Hello there' }, context)

    const error = await stalePageError(() =>
      test.kanso.posts.update(post.id, { title: 'Hi', baseUpdatedAt: loadedAt }, context),
    )
    expect(error.code).toBe('stale')
    // Nothing of the refused save was written, not even a revision.
    const revisions = await test.kanso.revisions.list('post', post.id)
    expect(revisions).toHaveLength(1)
  })
})
