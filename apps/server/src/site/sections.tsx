import type { Kanso } from '@kanso/core'
import { type PageSection, type SectionValues, sectionValuesSchemaFor } from '@kanso/shared'
import type { SectionDefinition, SectionResolvedData, Theme } from './themes/types.ts'

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
      const data = await resolveData(kanso, definition, parsed.data)
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
  definition: SectionDefinition,
  values: SectionValues,
): Promise<SectionResolvedData> {
  const data: SectionResolvedData = { images: {}, posts: {} }
  for (const field of definition.fields) {
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
