import { describe, expect, it } from 'vitest'
import { planStarterInstall, referencedMediaIds, type StarterBuild, stableJson } from './starter.ts'

const doc = { type: 'doc' as const, content: [] }

const build: StarterBuild = {
  form: {
    slug: 'contact',
    name: 'Contact',
    fields: [
      {
        type: 'text',
        name: 'name',
        label: 'Name',
        required: true,
        placeholder: null,
        help: null,
        maxLength: 100,
      },
    ],
    notifyTo: '',
    successMessage: '',
    redirectUrl: null,
    turnstile: false,
  },
  postType: { slug: 'news', name: 'News' },
  categories: [{ key: 'info', input: { slug: 'info', name: 'Info' } }],
  posts: [{ categoryKey: 'info', input: { title: 'Hello', slug: 'hello', bodyJson: doc } }],
  pages: [
    { title: 'Contact', slug: 'contact' },
    { title: 'About', slug: 'about' },
    { title: 'Home', slug: 'home' },
  ],
  themeSettings: { theme: 'default', values: { accent: '#2f6f5e' } },
  siteDescription: 'Sample',
}

const nothingTaken = {
  pagePaths: new Set<string>(),
  postTypeSlugs: new Set<string>(),
  formSlugs: new Set<string>(),
}

describe('planStarterInstall', () => {
  it('creates everything on an empty site', () => {
    const plan = planStarterInstall(build, nothingTaken)
    expect(plan.skipped).toEqual([])
    expect(plan.form?.slug).toBe('contact')
    expect(plan.postType?.slug).toBe('news')
    expect(plan.pages.map((page) => page.slug)).toEqual(['contact', 'about', 'home'])
  })

  it('skips taken slugs, treating pages and post types as one URL namespace', () => {
    const plan = planStarterInstall(build, {
      // A page at /news blocks the post type; a post type `about` blocks the page.
      pagePaths: new Set(['news', 'contact']),
      postTypeSlugs: new Set(['about']),
      formSlugs: new Set(['contact']),
    })
    expect(plan.form).toBeNull()
    expect(plan.postType).toBeNull()
    expect(plan.pages.map((page) => page.slug)).toEqual(['home'])
    expect(plan.skipped).toEqual([
      { kind: 'form', slug: 'contact' },
      { kind: 'postType', slug: 'news' },
      { kind: 'page', slug: 'contact' },
      { kind: 'page', slug: 'about' },
    ])
  })

  it('rejects reserved slugs in the starter content', () => {
    expect(() =>
      planStarterInstall({ ...build, pages: [{ title: 'Admin', slug: 'admin' }] }, nothingTaken),
    ).toThrow(/reserved/)
  })
})

describe('referencedMediaIds', () => {
  const candidates = [
    { id: 1, r2Key: '2026/11/hero.webp' },
    { id: 2, r2Key: '2026/11/about.webp' },
    { id: 3, r2Key: '2026/11/news.webp' },
    { id: 4, r2Key: '2026/11/unused.webp' },
  ]

  it('finds references from columns, section values and rich text bodies', () => {
    const referenced = referencedMediaIds({
      candidates,
      direct: [null, 3],
      sections: [[{ id: 'hero', type: 'hero', settings: { heading: 'Hi', image: 1 } }], null],
      bodies: [
        { type: 'doc', content: [{ type: 'image', attrs: { src: '/media/2026/11/about.webp' } }] },
      ],
    })
    expect([...referenced].sort()).toEqual([1, 2, 3])
  })

  it('ignores ids that are not candidates', () => {
    const referenced = referencedMediaIds({
      candidates,
      direct: [99],
      sections: [[{ id: 'a', type: 'hero', settings: { image: 42 } }]],
      bodies: [],
    })
    expect(referenced.size).toBe(0)
  })
})

describe('stableJson', () => {
  it('compares objects regardless of key order', () => {
    expect(stableJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      stableJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    )
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: '1' }))
    expect(stableJson(undefined)).toBe(stableJson(undefined))
  })
})
