import {
  createFormSchema,
  createRedirectSchema,
  type ExportBundle,
  importBundleSchema,
  SETTINGS_KEYS,
  sectionFieldListSchema,
  siteSettingsSchema,
} from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestKanso, type TestKanso } from '../testing/index.ts'

const context = { allowRawHtml: false }
const adminImport = {
  allowRawHtml: true,
  userId: null,
  canImportSettings: true,
  turnstileAvailable: false,
}
const editorImport = { ...adminImport, allowRawHtml: false, canImportSettings: false }

function doc(text: string) {
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
  }
}

/** Parse the way the API does, so defaults are applied before the service runs. */
function bundleOf(input: Record<string, unknown>): ExportBundle {
  return importBundleSchema.parse({ version: 1, exportedAt: '2026-11-12T00:00:00.000Z', ...input })
}

/** A small but complete site: every kind of row the bundle carries. */
async function seedSite(test: TestKanso) {
  const { kanso } = test
  const news = await kanso.postTypes.create({
    slug: 'news',
    name: 'お知らせ',
    fields: sectionFieldListSchema.parse([{ type: 'text', name: 'venue', label: '会場' }]),
  })
  const parent = await kanso.taxonomies.createCategory(news.id, {
    slug: 'events',
    name: 'イベント',
  })
  await kanso.taxonomies.createCategory(news.id, {
    slug: 'workshops',
    name: 'ワークショップ',
    parentId: parent.id,
  })
  await kanso.taxonomies.createTag({ slug: 'tokyo', name: '東京' })
  const company = await kanso.pages.create(
    { title: '会社概要', slug: 'company', status: 'published', bodyJson: doc('会社の紹介') },
    context,
  )
  await kanso.pages.create(
    { title: 'チーム', slug: 'team', parentId: company.id, status: 'draft', bodyJson: doc('team') },
    context,
  )
  const categoryIds = (await kanso.taxonomies.listCategories(news.id)).map((row) => row.id)
  const tagIds = (await kanso.taxonomies.listTags()).map((row) => row.id)
  await kanso.posts.create(
    {
      postTypeId: news.id,
      slug: 'launch',
      title: '公開しました',
      status: 'published',
      publishedAt: '2026-10-01T00:00:00.000Z',
      pinned: true,
      bodyJson: doc('本文'),
      categoryIds,
      tagIds,
      fields: { venue: 'Tokyo' },
    },
    { ...context, authorId: null },
  )
  await kanso.redirects.create(
    createRedirectSchema.parse({ fromPath: '/old', to: '/company', status: 301 }),
  )
  // A 410 rule has no target; it must survive the round trip as one.
  await kanso.redirects.create(createRedirectSchema.parse({ fromPath: '/retired', status: 410 }))
  await kanso.menus.create({
    slug: 'header',
    name: 'ヘッダー',
    items: [{ label: '会社概要', href: '/company', children: [] }],
  })
  await kanso.forms.create(
    createFormSchema.parse({
      slug: 'contact',
      name: 'お問い合わせ',
      fields: [{ type: 'email', name: 'email', label: 'メール', required: true }],
      notifyTo: 'owner@example.com',
    }),
    { turnstileAvailable: false },
  )
}

function comparable(bundle: ExportBundle) {
  const { exportedAt: _exportedAt, media: _media, ...rest } = bundle
  return rest
}

describe('export and import', () => {
  let source: TestKanso
  let target: TestKanso

  beforeEach(() => {
    source = createTestKanso()
    target = createTestKanso()
  })
  afterEach(() => {
    source.close()
    target.close()
  })

  it('reproduces a site in an empty one, and a second run changes nothing', async () => {
    await seedSite(source)
    const bundle = await source.kanso.transfer.export({ settings: false })

    const first = await target.kanso.transfer.import(bundleOf(bundle), adminImport)
    expect(first).toEqual({ created: 11, updated: 0, skipped: 0, warnings: [] })
    expect(comparable(await target.kanso.transfer.export({ settings: false }))).toEqual(
      comparable(bundle),
    )

    const second = await target.kanso.transfer.import(bundleOf(bundle), adminImport)
    expect(second).toEqual({ created: 0, updated: 0, skipped: 11, warnings: [] })
  })

  it('renders imported content the same way the editor would', async () => {
    await seedSite(source)
    await target.kanso.transfer.import(
      bundleOf(await source.kanso.transfer.export({ settings: false })),
      adminImport,
    )

    const company = await target.kanso.pages.findPublishedByPath('company')
    expect(company?.bodyHtml).toContain('会社の紹介')
    const type = await target.kanso.postTypes.findBySlug('news')
    const post = await target.kanso.posts.findPublished(type?.id ?? 0, 'launch')
    expect(post).toMatchObject({ pinned: true, fieldsJson: { venue: 'Tokyo' } })
    expect(post?.categories.map((row) => row.slug).sort()).toEqual(['events', 'workshops'])
    expect(post?.tags.map((row) => row.slug)).toEqual(['tokyo'])
    // The search index is maintained by triggers, so imported rows are searchable.
    const found = await target.kanso.search.search({ q: '会社の紹介', page: 1, perPage: 10 })
    expect(found.total).toBe(1)
    const categories = await target.kanso.taxonomies.listCategories(type?.id ?? 0)
    const events = categories.find((row) => row.slug === 'events')
    expect(categories.find((row) => row.slug === 'workshops')?.parentId).toBe(events?.id)
  })

  it('stays inside the Workers Free query budget for a full request', async () => {
    const posts = Array.from({ length: 100 }, (_, index) => ({
      postType: 'news',
      slug: `post-${index}`,
      title: `Post ${index}`,
      status: 'published',
      bodyJson: doc(`body ${index}`),
      categories: ['events'],
      tags: ['tokyo', 'osaka'],
    }))
    const pages = Array.from({ length: 100 }, (_, index) => ({
      path: index % 2 === 0 ? `page-${index}` : `page-${index - 1}/child`,
      title: `Page ${index}`,
      status: 'published',
      bodyJson: doc(`page ${index}`),
    }))
    const bundle = bundleOf({
      postTypes: [{ slug: 'news', name: 'News' }],
      categories: [{ postType: 'news', slug: 'events', name: 'Events' }],
      tags: [
        { slug: 'tokyo', name: 'Tokyo' },
        { slug: 'osaka', name: 'Osaka' },
      ],
      pages,
      posts,
    })

    target.resetQueries()
    const created = await target.kanso.transfer.import(bundle, adminImport)
    const createQueries = target.queries()
    target.resetQueries()
    const unchanged = await target.kanso.transfer.import(bundle, adminImport)
    const unchangedQueries = target.queries()

    expect(created).toMatchObject({ created: 204, warnings: [] })
    expect(unchanged).toMatchObject({ created: 0, updated: 0, skipped: 204 })
    // 50 is the whole invocation's budget; the request itself also spends a
    // few on the session, the activity log and the cache generation.
    expect(createQueries).toBeLessThanOrEqual(35)
    expect(unchangedQueries).toBeLessThanOrEqual(20)
    const type = await target.kanso.postTypes.findBySlug('news')
    const listed = await target.kanso.posts.listPublished({
      postTypeId: type?.id ?? 0,
      page: 1,
      perPage: 5,
      tagId: (await target.kanso.taxonomies.findTagBySlug('osaka'))?.id,
    })
    expect(listed.total).toBe(100)
  })

  it('updates changed content and keeps the previous version as a revision', async () => {
    await seedSite(source)
    const bundle = await source.kanso.transfer.export({ settings: false })
    await target.kanso.transfer.import(bundleOf(bundle), adminImport)

    const changed = bundleOf({
      ...bundle,
      pages: bundle.pages.map((page) =>
        page.path === 'company'
          ? { ...page, title: '会社案内', bodyJson: doc('新しい紹介') }
          : page,
      ),
      posts: bundle.posts.map((post) => ({ ...post, categories: ['events'], tags: [] })),
    })
    const report = await target.kanso.transfer.import(changed, adminImport)

    expect(report).toMatchObject({ created: 0, updated: 2, warnings: [] })
    const page = await target.kanso.pages.findPublishedByPath('company')
    expect(page).toMatchObject({ title: '会社案内' })
    expect(page?.bodyHtml).toContain('新しい紹介')
    const revisions = await target.kanso.revisions.list('page', page?.id ?? 0)
    expect(revisions.map((row) => row.title)).toEqual(['会社概要'])
    const type = await target.kanso.postTypes.findBySlug('news')
    const post = await target.kanso.posts.findPublished(type?.id ?? 0, 'launch')
    expect(post?.categories.map((row) => row.slug)).toEqual(['events'])
    expect(post?.tags).toEqual([])
    // Published content keeps its publication date when the bundle repeats it.
    expect(post?.publishedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('skips what cannot be imported and reports why, importing the rest', async () => {
    await target.kanso.pages.create({ title: 'Shop', slug: 'shop', status: 'draft' }, context)
    const report = await target.kanso.transfer.import(
      bundleOf({
        postTypes: [
          { slug: 'shop', name: 'Clashes with a page' },
          { slug: 'media', name: 'Reserved' },
          { slug: 'blog', name: 'Blog', hasTags: false },
        ],
        categories: [
          { postType: 'nope', slug: 'a', name: 'A' },
          { postType: 'blog', slug: 'b', name: 'B', parent: 'c' },
          { postType: 'blog', slug: 'c', name: 'C', parent: 'b' },
        ],
        tags: [{ slug: 't', name: 'T' }],
        pages: [
          { path: 'admin', title: 'Reserved' },
          { path: 'blog', title: 'Clashes with a post type' },
          { path: 'orphan/child', title: 'No parent' },
          { path: 'fine', title: 'Fine' },
          { path: 'fine', title: 'Duplicate' },
        ],
        posts: [
          { postType: 'nope', slug: 'x', title: 'No type' },
          { postType: 'blog', slug: 'ok', title: 'OK', categories: ['b', 'zzz'], tags: ['t'] },
        ],
        redirects: [{ fromPath: '/loop', to: '/loop' }],
      }),
      adminImport,
    )

    const warnings = report.warnings.join('\n')
    expect(report.created).toBe(6) // blog, b, c, t, page "fine", post "ok"
    expect(warnings).toMatch(/postTypes\[shop\]: slug is used by a page/)
    expect(warnings).toMatch(/postTypes\[media\]: slug is reserved/)
    expect(warnings).toMatch(/categories\[nope\/a\]: post type "nope" does not exist/)
    expect(warnings).toMatch(/categories\[blog\/c\]: parent "b" would make/)
    expect(warnings).toMatch(/pages\[admin\]: slug is reserved/)
    expect(warnings).toMatch(/pages\[blog\]: slug is used by a post type/)
    expect(warnings).toMatch(/pages\[orphan\/child\]: parent page "orphan"/)
    expect(warnings).toMatch(/pages\[fine\]: listed more than once/)
    expect(warnings).toMatch(/posts\[nope\/x\]: post type "nope" does not exist/)
    expect(warnings).toMatch(/posts\[blog\/ok\]: category "zzz" does not exist/)
    expect(warnings).toMatch(/posts\[blog\/ok\]: post type "blog" does not use tags/)
    expect(warnings).toMatch(/redirects\[\/loop\]/)

    const blog = await target.kanso.postTypes.findBySlug('blog')
    const [listed] = (await target.kanso.posts.list({ postTypeId: blog?.id })).items
    const post = await target.kanso.posts.get(listed?.id ?? 0)
    expect(post.categoryIds).toHaveLength(1)
    expect(post.tagIds).toEqual([])
  })

  it('imports over a trashed page or post with the same address', async () => {
    const type = await target.kanso.postTypes.create({ slug: 'news', name: 'News' })
    const page = await target.kanso.pages.create(
      { title: 'Old', slug: 'about', status: 'draft' },
      context,
    )
    const post = await target.kanso.posts.create(
      { postTypeId: type.id, slug: 'hello', title: 'Old', status: 'draft' },
      { ...context, authorId: null },
    )
    await target.kanso.pages.delete(page.id)
    await target.kanso.posts.delete(post.id)

    const report = await target.kanso.transfer.import(
      bundleOf({
        pages: [{ path: 'about', title: 'New' }],
        posts: [{ postType: 'news', slug: 'hello', title: 'New' }],
      }),
      adminImport,
    )

    expect(report).toMatchObject({ created: 2, warnings: [] })
    expect((await target.kanso.pages.list({})).items.map((row) => row.title)).toEqual(['New'])
    expect((await target.kanso.pages.list({ trashed: 'true' })).total).toBe(1)
  })

  it('leaves rows alone that only differ in how an older version stored them', async () => {
    const type = await target.kanso.postTypes.create({ slug: 'news', name: 'News' })
    const page = await target.kanso.pages.create(
      { title: 'About', slug: 'about', status: 'draft' },
      context,
    )
    const post = await target.kanso.posts.create(
      { postTypeId: type.id, slug: 'hello', title: 'Hello', status: 'draft' },
      { ...context, authorId: null },
    )
    // A blank excerpt used to be stored as '' (now NULL), and a post written before
    // its type had custom fields has no values for them at all.
    target.exec("update pages set excerpt = ''")
    target.exec("update posts set excerpt = ''")
    await target.kanso.postTypes.update(type.id, {
      fields: sectionFieldListSchema.parse([{ type: 'text', name: 'venue', label: '会場' }]),
    })

    const bundle = await target.kanso.transfer.export({ settings: false })
    const report = await target.kanso.transfer.import(bundleOf(bundle), adminImport)

    expect(report).toEqual({ created: 0, updated: 0, skipped: 3, warnings: [] })
    expect(await target.kanso.revisions.list('page', page.id)).toEqual([])
    expect(await target.kanso.revisions.list('post', post.id)).toEqual([])
  })
})

describe('settings in a bundle', () => {
  let test: TestKanso

  beforeEach(() => {
    test = createTestKanso()
  })
  afterEach(() => test.close())

  it('never exports or imports the sample-content manifest or the cache generation', async () => {
    await test.kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, { title: 'Source' })
    const manifest = JSON.stringify({
      installedAt: '2026-11-12T00:00:00.000Z',
      pages: [1, 2],
      posts: [1],
      postTypes: [1],
      categories: [],
      tags: [],
      forms: [],
      media: [],
      themeSettings: null,
      siteDescription: null,
    })
    test.exec(
      `insert into settings (key, value_json) values ('starter', '${manifest}'), ('cache', '{"version":"abc"}')`,
    )

    const exported = await test.kanso.transfer.export({ settings: true })
    expect(Object.keys(exported.settings ?? {})).toEqual(['site'])

    const target = createTestKanso()
    const report = await target.kanso.transfer.import(
      bundleOf({
        settings: {
          site: { title: 'Imported' },
          starter: JSON.parse(manifest),
          cache: { version: 'zzz' },
        },
      }),
      adminImport,
    )

    expect(report.created).toBe(1)
    expect(report.warnings).toEqual([
      'settings[starter]: belongs to the site it was exported from; not imported',
      'settings[cache]: belongs to the site it was exported from; not imported',
    ])
    expect(await target.kanso.settings.starter()).toBeNull()
    expect((await target.kanso.settings.site()).title).toBe('Imported')
    target.close()
  })

  it('applies settings only for an administrator', async () => {
    const bundle = bundleOf({
      settings: { site: { title: 'Changed', headHtml: '<script>alert(1)</script>' } },
    })

    const refused = await test.kanso.transfer.import(bundle, editorImport)
    expect(refused).toMatchObject({ created: 0, updated: 0, skipped: 1 })
    expect(refused.warnings[0]).toMatch(/only an administrator/)
    expect((await test.kanso.settings.site()).headHtml).toBeNull()

    const applied = await test.kanso.transfer.import(bundle, adminImport)
    expect(applied).toMatchObject({ created: 1, warnings: [] })
    expect((await test.kanso.settings.site()).title).toBe('Changed')
  })

  it('points the custom 404 page at a page created by the same import', async () => {
    const report = await test.kanso.transfer.import(
      bundleOf({
        pages: [{ path: 'not-found', title: 'Not found', status: 'published' }],
        settings: { site: { title: 'Site', notFoundPageId: { $ref: 'page', path: 'not-found' } } },
      }),
      adminImport,
    )

    expect(report).toMatchObject({ created: 2, warnings: [] })
    const page = await test.kanso.pages.findPublishedByPath('not-found')
    expect((await test.kanso.settings.site()).notFoundPageId).toBe(page?.id)
  })

  it('drops the Turnstile requirement where Turnstile is not configured', async () => {
    const form = {
      slug: 'contact',
      name: 'Contact',
      fields: [{ type: 'text', name: 'name', label: 'Name' }],
      turnstile: true,
    }
    const without = await test.kanso.transfer.import(bundleOf({ forms: [form] }), adminImport)
    expect(without.warnings).toEqual([
      'forms[contact]: Turnstile is not configured on this site; imported without it',
    ])
    expect((await test.kanso.forms.findBySlug('contact'))?.turnstile).toBe(false)

    const withTurnstile = await test.kanso.transfer.import(bundleOf({ forms: [form] }), {
      ...adminImport,
      turnstileAvailable: true,
    })
    expect(withTurnstile).toMatchObject({ updated: 1, warnings: [] })
    expect((await test.kanso.forms.findBySlug('contact'))?.turnstile).toBe(true)
  })
})

describe('images inside sections and custom fields', () => {
  const sectionFields = (type: string) =>
    type === 'hero'
      ? sectionFieldListSchema.parse([
          { type: 'text', name: 'heading', label: 'Heading' },
          { type: 'image', name: 'image', label: 'Image' },
        ])
      : undefined

  function addMedia(test: TestKanso, key: string) {
    test.exec(
      `insert into media (r2_key, filename, mime, size) values ('${key}', 'a.webp', 'image/webp', 10)`,
    )
  }

  async function source() {
    const test = createTestKanso()
    // Push the id up so that it cannot coincide with the target's by accident.
    addMedia(test, 'media/filler-1.webp')
    addMedia(test, 'media/filler-2.webp')
    addMedia(test, 'media/hero.webp')
    const type = await test.kanso.postTypes.create({
      slug: 'works',
      name: 'Works',
      fields: sectionFieldListSchema.parse([{ type: 'image', name: 'photo', label: 'Photo' }]),
    })
    await test.kanso.pages.create(
      {
        title: 'Home',
        slug: 'home',
        status: 'published',
        sections: [{ id: 's1', type: 'hero', settings: { heading: 'Hello', image: 3 } }],
      },
      context,
    )
    await test.kanso.posts.create(
      { postTypeId: type.id, slug: 'one', title: 'One', status: 'published', fields: { photo: 3 } },
      { ...context, authorId: null },
    )
    return test
  }

  it('exports them by media key and resolves them against the target site', async () => {
    const from = await source()
    const bundle = await from.kanso.transfer.export({ settings: false, sectionFields })
    expect(bundle.pages[0]?.sections?.[0]?.settings.image).toEqual({
      $ref: 'media',
      key: 'media/hero.webp',
    })
    expect(bundle.posts[0]?.fields?.photo).toEqual({ $ref: 'media', key: 'media/hero.webp' })

    const to = createTestKanso()
    addMedia(to, 'media/hero.webp') // id 1 here, 3 on the source
    const report = await to.kanso.transfer.import(bundleOf(bundle), {
      ...adminImport,
      sectionFields,
    })

    expect(report.warnings).toEqual([])
    const home = await to.kanso.pages.findPublishedByPath('home')
    expect(home?.sectionsJson?.[0]?.settings).toEqual({ heading: 'Hello', image: 1 })
    const type = await to.kanso.postTypes.findBySlug('works')
    expect((await to.kanso.posts.findPublished(type?.id ?? 0, 'one'))?.fieldsJson).toEqual({
      photo: 1,
    })
    // A second run sees no difference.
    const again = await to.kanso.transfer.import(bundleOf(bundle), {
      ...adminImport,
      sectionFields,
    })
    expect(again).toMatchObject({ created: 0, updated: 0 })
    from.close()
    to.close()
  })

  it('clears an image the target site does not have, and says so', async () => {
    const from = await source()
    const bundle = await from.kanso.transfer.export({ settings: false, sectionFields })
    const to = createTestKanso()
    addMedia(to, 'media/unrelated.webp')
    addMedia(to, 'media/unrelated-2.webp')
    addMedia(to, 'media/unrelated-3.webp') // id 3: what a bare id would have pointed at

    const report = await to.kanso.transfer.import(bundleOf(bundle), {
      ...adminImport,
      sectionFields,
    })

    expect(report.warnings).toEqual([
      'pages[home]: media "media/hero.webp" is not in this site',
      'posts[works/one]: media "media/hero.webp" is not in this site',
    ])
    const home = await to.kanso.pages.findPublishedByPath('home')
    expect(home?.sectionsJson?.[0]?.settings.image).toBeNull()
    from.close()
    to.close()
  })

  it('never trusts a bare media id from another site', async () => {
    const to = createTestKanso()
    addMedia(to, 'media/unrelated.webp')
    const report = await to.kanso.transfer.import(
      bundleOf({
        pages: [
          {
            path: 'home',
            title: 'Home',
            sections: [{ id: 's1', type: 'hero', settings: { heading: 'Hi', image: 1 } }],
          },
        ],
      }),
      { ...adminImport, sectionFields },
    )

    expect(report.warnings).toEqual(['pages[home]: image "image" has no media key; cleared'])
    const [page] = (await to.kanso.pages.list({})).items
    expect((await to.kanso.pages.get(page?.id ?? 0)).sectionsJson?.[0]?.settings.image).toBeNull()
    to.close()
  })
})
