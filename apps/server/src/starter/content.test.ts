import { renderRichText } from '@kanso/core'
import {
  createCategorySchema,
  createFormSchema,
  createPageSchema,
  createPostSchema,
  createPostTypeSchema,
  sectionValuesSchemaFor,
  siteSettingsSchema,
  THEME_NAMES,
} from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import {
  invalidSectionDetails,
  sectionsMetaByTheme,
  standardThemeSettingsFields,
} from '../site/themes/sections-meta.ts'
import { STARTER_IMAGES, type StarterMedia, starterContent } from './content.ts'

const media = Object.fromEntries(
  STARTER_IMAGES.map((image, index) => [
    image.name,
    { id: index + 1, url: `/media/2026/11/${image.name}` },
  ]),
) as StarterMedia

const now = new Date('2026-11-08T03:00:00.000Z')
const content = starterContent({ siteTitle: 'Example Shop', media, now })

function pageBySlug(slug: string) {
  const page = content.pages.find((item) => item.slug === slug)
  if (!page) throw new Error(`Missing starter page ${slug}`)
  return page
}

describe('starterContent', () => {
  it('produces a valid form, post type and categories', () => {
    const form = createFormSchema.parse(content.form)
    expect(form.slug).toBe('contact')
    expect(form.fields.map((field) => field.name)).toEqual(['name', 'email', 'topic', 'message'])
    expect(form.successMessage).not.toBe('')

    expect(createPostTypeSchema.parse(content.postType)).toMatchObject({
      slug: 'news',
      hasCategories: true,
      hasTags: false,
    })
    for (const category of content.categories) {
      expect(createCategorySchema.safeParse(category.input).success).toBe(true)
    }
  })

  it('produces published posts with covers, staggered dates and rendered bodies', () => {
    expect(content.posts).toHaveLength(3)
    const slugs = new Set<string>()
    for (const post of content.posts) {
      const parsed = createPostSchema.parse({ ...post.input, postTypeId: 1, categoryIds: [1] })
      expect(parsed.status).toBe('published')
      expect(parsed.coverMediaId).toEqual(expect.any(Number))
      expect(new Date(parsed.publishedAt ?? '').getTime()).toBeLessThanOrEqual(now.getTime())
      expect(
        renderRichText(parsed.bodyJson ?? { type: 'doc', content: [] }, { allowRawHtml: false }),
      ).not.toBe('')
      slugs.add(parsed.slug)
    }
    expect(slugs.size).toBe(3)
    const dates = content.posts.map((post) => post.input.publishedAt)
    expect(new Set(dates).size).toBe(3)
  })

  it('produces valid pages in creation order with the home page last', () => {
    expect(content.pages.map((page) => page.slug)).toEqual(['contact', 'about', 'services', 'home'])
    for (const page of content.pages) {
      const parsed = createPageSchema.parse(page)
      expect(parsed.status).toBe('published')
    }
    expect(content.pages.map((page) => [page.slug, page.sortOrder])).toEqual([
      ['contact', 3],
      ['about', 1],
      ['services', 2],
      ['home', 0],
    ])
  })

  it('builds section pages that every bundled theme accepts', () => {
    for (const slug of ['home', 'services']) {
      const sections = createPageSchema.parse(pageBySlug(slug)).sections ?? []
      expect(sections.length).toBeGreaterThan(0)
      for (const theme of THEME_NAMES) {
        expect(invalidSectionDetails(sectionsMetaByTheme[theme], sections)).toEqual([])
      }
    }
    const home = pageBySlug('home').sections ?? []
    expect(home[0]).toMatchObject({ type: 'hero', settings: { heading: 'Example Shop' } })
    expect(home.find((section) => section.type === 'post_list')?.settings).toMatchObject({
      source: { postTypeSlug: 'news', limit: 3 },
    })
  })

  it('renders the rich text pages with the form embed, image and site name', () => {
    const render = (slug: string) =>
      renderRichText(
        createPageSchema.parse(pageBySlug(slug)).bodyJson ?? { type: 'doc', content: [] },
        {
          allowRawHtml: false,
        },
      )
    expect(render('contact')).toContain('data-kanso-form="contact"')
    const about = render('about')
    expect(about).toContain('src="/media/2026/11/about.webp"')
    expect(about).toContain('Example Shop')
    expect(about).toContain('（サンプル）')
  })

  it('produces valid theme settings and site description', () => {
    const values = sectionValuesSchemaFor(standardThemeSettingsFields).parse(content.themeSettings)
    expect(values.accent).toBe('#2f6f5e')
    expect(values.footer_text).not.toBe('')
    const site = siteSettingsSchema.parse({ description: content.siteDescription })
    expect(site.description).toContain('Example Shop')
  })
})
