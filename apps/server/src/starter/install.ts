import { type Kanso, KansoError } from '@kanso/core'
import {
  createCategorySchema,
  createFormSchema,
  createPageSchema,
  createPostSchema,
  createPostTypeSchema,
  SETTINGS_KEYS,
  type StarterManifest,
  sectionValuesSchemaFor,
  siteSettingsSchema,
  starterManifestSchema,
} from '@kanso/shared'
import { themeSettingsFieldsByTheme } from '../site/themes/sections-meta.ts'
import { STARTER_IMAGES, type StarterMedia, starterContent } from './content.ts'

export type StarterSkippedKind = 'page' | 'postType' | 'form'

export interface StarterCounts {
  pages: number
  posts: number
  postTypes: number
  categories: number
  tags: number
  forms: number
  media: number
}

export interface StarterInstallResult {
  created: StarterCounts
  /** Items left alone because the slug or path was already taken. */
  skipped: { kind: StarterSkippedKind; slug: string }[]
}

export interface InstallStarterOptions {
  /** Recorded as the author of the starter posts. */
  userId: number | null
  /** Bytes of a bundled image under `public/starter/`, by file name. */
  loadImage: (name: string) => Promise<ArrayBuffer>
  now?: Date
}

export function starterCounts(manifest: StarterManifest): StarterCounts {
  return {
    pages: manifest.pages.length,
    posts: manifest.posts.length,
    postTypes: manifest.postTypes.length,
    categories: manifest.categories.length,
    tags: manifest.tags.length,
    forms: manifest.forms.length,
    media: manifest.media.length,
  }
}

function isConflict(error: unknown): boolean {
  return error instanceof KansoError && error.code === 'conflict'
}

function recordsAnything(manifest: StarterManifest): boolean {
  return (
    Object.values(starterCounts(manifest)).some((count) => count > 0) ||
    manifest.themeSettings !== null ||
    manifest.siteDescription !== null
  )
}

/**
 * Create the starter site through the regular services, skipping anything
 * whose slug or path is already taken, and record what was created in the
 * `starter` setting so it can be removed later.
 */
export async function installStarter(
  kanso: Kanso,
  options: InstallStarterOptions,
): Promise<StarterInstallResult> {
  if (await kanso.settings.starter()) {
    throw KansoError.conflict('Starter content is already installed')
  }

  const now = options.now ?? new Date()
  const manifest: StarterManifest = {
    installedAt: now.toISOString(),
    pages: [],
    posts: [],
    postTypes: [],
    categories: [],
    tags: [],
    forms: [],
    media: [],
    themeSettings: null,
    siteDescription: null,
  }
  const skipped: StarterInstallResult['skipped'] = []
  let completed = false

  /** Run a create call; a slug/path conflict skips the item instead of failing. */
  async function createUnlessTaken<T>(
    kind: StarterSkippedKind,
    slug: string,
    create: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await create()
    } catch (error) {
      if (!isConflict(error)) throw error
      skipped.push({ kind, slug })
      return null
    }
  }

  try {
    const media: Partial<StarterMedia> = {}
    for (const image of STARTER_IMAGES) {
      const bytes = await options.loadImage(image.name)
      const item = await kanso.media.upload({ bytes, filename: image.name, alt: image.alt })
      manifest.media.push(item.id)
      media[image.name] = { id: item.id, url: item.url }
    }

    const site = await kanso.settings.site()
    const content = starterContent({ siteTitle: site.title, media: media as StarterMedia, now })

    const form = await createUnlessTaken('form', content.form.slug, () =>
      kanso.forms.create(createFormSchema.parse(content.form), { turnstileAvailable: false }),
    )
    if (form) manifest.forms.push(form.id)

    const postType = await createUnlessTaken('postType', content.postType.slug, () =>
      kanso.postTypes.create(createPostTypeSchema.parse(content.postType)),
    )
    // Posts and categories only go into a post type this run created, never an existing one.
    if (postType) {
      manifest.postTypes.push(postType.id)
      const categoryIds = new Map<string, number>()
      for (const category of content.categories) {
        const created = await kanso.taxonomies.createCategory(
          postType.id,
          createCategorySchema.parse(category.input),
        )
        manifest.categories.push(created.id)
        categoryIds.set(category.key, created.id)
      }
      for (const post of content.posts) {
        const categoryId = categoryIds.get(post.category)
        const created = await kanso.posts.create(
          createPostSchema.parse({
            ...post.input,
            postTypeId: postType.id,
            categoryIds: categoryId === undefined ? [] : [categoryId],
          }),
          { allowRawHtml: false, authorId: options.userId },
        )
        manifest.posts.push(created.id)
      }
    }

    for (const page of content.pages) {
      const created = await createUnlessTaken('page', page.slug, () =>
        kanso.pages.create(createPageSchema.parse(page), { allowRawHtml: false }),
      )
      if (created) manifest.pages.push(created.id)
    }

    const allThemeSettings = await kanso.settings.theme()
    const current = allThemeSettings[site.theme]
    if (!current || Object.keys(current).length === 0) {
      const values = sectionValuesSchemaFor(themeSettingsFieldsByTheme[site.theme]).parse(
        content.themeSettings,
      )
      await kanso.settings.updateTheme({ ...allThemeSettings, [site.theme]: values })
      manifest.themeSettings = { theme: site.theme, values }
    }

    if (site.description.trim() === '') {
      await kanso.settings.set(SETTINGS_KEYS.site, siteSettingsSchema, {
        ...site,
        description: content.siteDescription,
      })
      manifest.siteDescription = content.siteDescription
    }
    completed = true
  } finally {
    // A failed run still records what it created, so removal can clean it up.
    if (completed || recordsAnything(manifest)) {
      await kanso.settings.set(SETTINGS_KEYS.starter, starterManifestSchema, manifest)
    }
  }

  return { created: starterCounts(manifest), skipped }
}
