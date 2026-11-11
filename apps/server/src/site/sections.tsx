import type { Kanso } from '@kanso/core'
import {
  type PageSection,
  type SectionField,
  type SectionValues,
  sectionValuesSchemaFor,
} from '@kanso/shared'
import type {
  PostFieldItem,
  SectionDefinition,
  SectionResolvedData,
  Theme,
} from './themes/types.ts'

export interface PreparedSection {
  /** Editor-assigned section id. */
  id: string
  type: string
  definition: SectionDefinition
  values: SectionValues
  data: SectionResolvedData
}

/**
 * Validate stored sections against the theme's catalog and resolve the data
 * their image / posts fields need, ahead of the synchronous JSX render.
 * Unknown types and invalid settings skip the section instead of failing the
 * page, so switching themes never breaks published pages.
 */
export async function prepareSections(
  kanso: Kanso,
  theme: Theme,
  sections: PageSection[],
): Promise<PreparedSection[]> {
  const prepared = await Promise.all(
    sections.map(async (section) => {
      const definition = theme.sections[section.type]
      if (!definition) {
        console.warn(`sections: skipping unknown type "${section.type}"`)
        return null
      }
      const parsed = sectionValuesSchemaFor(definition.fields).safeParse(section.settings)
      if (!parsed.success) {
        console.warn(`sections: skipping "${section.type}" (${section.id}): invalid settings`)
        return null
      }
      const data = await resolveData(kanso, definition.fields, parsed.data)
      return {
        id: section.id,
        type: section.type,
        definition,
        values: parsed.data,
        data,
      } satisfies PreparedSection
    }),
  )
  return prepared.filter((section) => section !== null)
}

async function resolveData(
  kanso: Kanso,
  fields: SectionField[],
  values: SectionValues,
): Promise<SectionResolvedData> {
  const data: SectionResolvedData = { images: {}, posts: {} }
  for (const field of fields) {
    if (field.type === 'image') {
      const mediaId = values[field.name]
      const item = typeof mediaId === 'number' ? await kanso.media.find(mediaId) : null
      data.images[field.name] = item ? { url: item.url, alt: item.alt } : null
    }
    if (field.type === 'posts') {
      const value = values[field.name]
      data.posts[field.name] = null
      if (value && typeof value === 'object' && value.postTypeSlug) {
        const type = await kanso.postTypes.findBySlug(value.postTypeSlug)
        if (type) {
          const { items } = await kanso.posts.listPublished({
            postTypeId: type.id,
            page: 1,
            perPage: value.limit,
          })
          data.posts[field.name] = {
            typeSlug: type.slug,
            typeName: type.name,
            items: items.map((post) => ({
              id: post.id,
              title: post.title,
              href: `/${type.slug}/${post.slug}`,
              excerpt: post.excerpt,
              publishedAt: post.publishedAt,
            })),
          }
        }
      }
    }
  }
  return data
}

/**
 * Prepare a post's custom field values (post type `fields_json` definitions)
 * for the synchronous JSX render, resolving `image` / `posts` fields the same
 * way sections do. Definition changes are tolerated field by field: a stored
 * value that no longer fits its definition falls back to the field's default,
 * so nothing unvalidated (a non-http link in a `url` field, say) is rendered.
 */
export async function preparePostFields(
  kanso: Kanso,
  defs: SectionField[] | null | undefined,
  stored: SectionValues | null,
): Promise<PostFieldItem[]> {
  if (!defs || defs.length === 0) return []
  const values: SectionValues = {}
  for (const def of defs) {
    const schema = sectionValuesSchemaFor([def])
    const parsed = schema.safeParse({ [def.name]: stored?.[def.name] })
    Object.assign(values, parsed.success ? parsed.data : schema.parse({}))
  }
  const data = await resolveData(kanso, defs, values)
  return defs.map((def) => ({
    name: def.name,
    label: def.label,
    type: def.type,
    value: values[def.name] ?? null,
    image: def.type === 'image' ? (data.images[def.name] ?? null) : undefined,
    posts: def.type === 'posts' ? (data.posts[def.name] ?? null) : undefined,
  }))
}

export function SectionsBody({
  sections,
  formatDate,
}: {
  sections: PreparedSection[]
  formatDate: (date: Date) => string
}) {
  return (
    <div class="page-sections">
      {sections.map((section) => (
        <section.definition.Component
          values={section.values}
          data={section.data}
          formatDate={formatDate}
        />
      ))}
    </div>
  )
}
