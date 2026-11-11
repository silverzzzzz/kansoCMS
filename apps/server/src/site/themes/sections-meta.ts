import {
  type PageSection,
  type SectionField,
  sectionFieldListSchema,
  sectionValuesSchemaFor,
  type ThemeName,
} from '@kanso/shared'

/**
 * Section catalog metadata: everything about a section except its component.
 * Kept free of JSX so the management API (whose types reach the admin app via
 * the hc client) can import it without dragging theme components along.
 */
export interface SectionMeta {
  label: string
  description?: string
  fields: SectionField[]
}

export const standardSectionsMeta = {
  hero: {
    label: 'Hero',
    description: 'Large heading with optional image, text and button',
    fields: sectionFieldListSchema.parse([
      { type: 'text', name: 'heading', label: 'Heading', maxLength: 200 },
      { type: 'textarea', name: 'text', label: 'Text', maxLength: 2000 },
      { type: 'image', name: 'image', label: 'Image' },
      { type: 'text', name: 'button_label', label: 'Button label', maxLength: 60 },
      { type: 'url', name: 'button_url', label: 'Button link' },
    ]),
  },
  richtext: {
    label: 'Text',
    description: 'Heading and plain text paragraphs',
    fields: sectionFieldListSchema.parse([
      { type: 'text', name: 'heading', label: 'Heading', maxLength: 200 },
      { type: 'textarea', name: 'body', label: 'Body', maxLength: 10000 },
    ]),
  },
  post_list: {
    label: 'Latest posts',
    description: 'Most recent published posts of a post type',
    fields: sectionFieldListSchema.parse([
      { type: 'text', name: 'heading', label: 'Heading', maxLength: 200 },
      { type: 'posts', name: 'source', label: 'Posts' },
    ]),
  },
  image_with_text: {
    label: 'Image with text',
    description: 'Image beside a heading and text',
    fields: sectionFieldListSchema.parse([
      { type: 'image', name: 'image', label: 'Image' },
      { type: 'text', name: 'heading', label: 'Heading', maxLength: 200 },
      { type: 'textarea', name: 'body', label: 'Body', maxLength: 4000 },
      { type: 'checkbox', name: 'reverse', label: 'Image on the right' },
    ]),
  },
  cta: {
    label: 'Call to action',
    description: 'Heading with a button',
    fields: sectionFieldListSchema.parse([
      { type: 'text', name: 'heading', label: 'Heading', maxLength: 200 },
      { type: 'text', name: 'button_label', label: 'Button label', maxLength: 60 },
      { type: 'url', name: 'button_url', label: 'Button link' },
    ]),
  },
} satisfies Record<string, SectionMeta>

/** Per-theme section catalogs; the bundled themes share the standard set. */
export const sectionsMetaByTheme: Record<ThemeName, Record<string, SectionMeta>> = {
  default: standardSectionsMeta,
  paper: standardSectionsMeta,
}

/**
 * Field definitions of a section type, looked up across the bundled themes
 * (which share their type names). Export/import use it to find the image
 * settings inside sections, so those travel by media key instead of by id.
 */
export function sectionFieldsOf(type: string): SectionField[] | undefined {
  for (const catalog of Object.values(sectionsMetaByTheme)) {
    const meta = catalog[type]
    if (meta) return meta.fields
  }
  return undefined
}

/** Theme-wide settings (Shopify's settings_schema counterpart), same field DSL. */
export const standardThemeSettingsFields: SectionField[] = sectionFieldListSchema.parse([
  {
    type: 'color',
    name: 'accent',
    label: 'Accent color',
    help: 'Links and highlights. Leave empty for the theme default.',
  },
  { type: 'text', name: 'footer_text', label: 'Footer text', maxLength: 200 },
  { type: 'url', name: 'sns_url_1', label: 'Social link 1' },
  { type: 'url', name: 'sns_url_2', label: 'Social link 2' },
  { type: 'url', name: 'sns_url_3', label: 'Social link 3' },
  { type: 'url', name: 'sns_url_4', label: 'Social link 4' },
  { type: 'url', name: 'sns_url_5', label: 'Social link 5' },
])

export const themeSettingsFieldsByTheme: Record<ThemeName, SectionField[]> = {
  default: standardThemeSettingsFields,
  paper: standardThemeSettingsFields,
}

/**
 * Page templates (WP block patterns / STUDIO templates): preset section
 * layouts offered when creating a page. Sections omit `id`; the client
 * assigns one per instance, so a template can be inserted repeatedly.
 */
export interface PageTemplate {
  id: string
  name: string
  description: string
  sections: { type: string; settings: Record<string, unknown> }[]
}

const standardPageTemplates: PageTemplate[] = [
  {
    id: 'landing',
    name: 'ランディング',
    description: 'ヒーロー + 本文 + CTA',
    sections: [
      {
        type: 'hero',
        settings: {
          heading: 'ページの見出し',
          text: 'このページで伝えたいことを一文で。',
          button_label: '詳しく見る',
          button_url: '/',
        },
      },
      {
        type: 'richtext',
        settings: { heading: 'セクションの見出し', body: '本文をここに書きます。' },
      },
      {
        type: 'cta',
        settings: { heading: 'お問い合わせ', button_label: '問い合わせる', button_url: '/contact' },
      },
    ],
  },
  {
    id: 'services',
    name: 'サービス・料金一覧',
    description: 'ヒーロー + 画像付き項目 x2 + CTA',
    sections: [
      {
        type: 'hero',
        settings: { heading: 'サービス', text: '提供しているサービスの紹介です。' },
      },
      {
        type: 'image_with_text',
        settings: { heading: 'サービス 1', body: 'サービスの説明をここに書きます。' },
      },
      {
        type: 'image_with_text',
        settings: {
          heading: 'サービス 2',
          body: 'サービスの説明をここに書きます。',
          reverse: true,
        },
      },
      {
        type: 'cta',
        settings: { heading: 'お問い合わせ', button_label: '相談する', button_url: '/contact' },
      },
    ],
  },
  {
    id: 'about',
    name: '会社概要・ページについて',
    description: '本文 + 画像付き本文',
    sections: [
      {
        type: 'richtext',
        settings: { heading: 'このページについて', body: '概要をここに書きます。' },
      },
      {
        type: 'image_with_text',
        settings: { heading: '私たちについて', body: '詳しい説明をここに書きます。' },
      },
    ],
  },
  {
    id: 'guide',
    name: 'お問い合わせ誘導',
    description: '本文 + CTA',
    sections: [
      {
        type: 'richtext',
        settings: { heading: 'お問い合わせ', body: '案内文をここに書きます。' },
      },
      {
        type: 'cta',
        settings: {
          heading: 'まずはご相談ください',
          button_label: '問い合わせる',
          button_url: '/contact',
        },
      },
    ],
  },
]

/** Per-theme page templates; the bundled themes share the standard set. */
export const pageTemplatesByTheme: Record<ThemeName, PageTemplate[]> = {
  default: standardPageTemplates,
  paper: standardPageTemplates,
}

/**
 * Validation details for section input saved through the management API,
 * checked against a theme's catalog. Empty when everything is valid.
 */
export function invalidSectionDetails(
  catalog: Record<string, SectionMeta>,
  sections: PageSection[],
): { path: string; message: string }[] {
  const details: { path: string; message: string }[] = []
  sections.forEach((section, index) => {
    const meta = catalog[section.type]
    if (!meta) {
      details.push({
        path: `sections.${index}.type`,
        message: `Unknown section type "${section.type}"`,
      })
      return
    }
    const parsed = sectionValuesSchemaFor(meta.fields).safeParse(section.settings)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = ['sections', String(index), 'settings', ...issue.path.map(String)]
        details.push({ path: path.join('.'), message: issue.message })
      }
    }
  })
  return details
}
