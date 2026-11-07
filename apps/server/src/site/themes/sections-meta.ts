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
