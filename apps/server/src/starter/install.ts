import type { Kanso, StarterBuild, StarterSkipped } from '@kanso/core'
import {
  createCategorySchema,
  createFormSchema,
  createPageSchema,
  createPostSchema,
  createPostTypeSchema,
  type SiteSettings,
  type StarterCounts,
  sectionValuesSchemaFor,
  starterCounts,
} from '@kanso/shared'
import { themeSettingsFieldsByTheme } from '../site/themes/sections-meta.ts'
import { STARTER_IMAGES, type StarterMedia, starterContent } from './content.ts'

export interface StarterInstallResult {
  created: StarterCounts
  /** Items left alone because the slug or path was already taken. */
  skipped: StarterSkipped[]
}

export interface InstallStarterOptions {
  /** Recorded as the author of the starter posts. */
  userId: number | null
  /** Bytes of a bundled image under `public/starter/`, by file name. */
  loadImage: (name: string) => Promise<ArrayBuffer>
  now?: Date
}

const postContentSchema = createPostSchema.omit({
  postTypeId: true,
  categoryIds: true,
  tagIds: true,
})

/**
 * Validate the starter content with the same schemas as the management API
 * (and the theme's settings fields) and shape it for the core bulk install.
 */
export function starterBuild(site: SiteSettings, media: StarterMedia, now: Date): StarterBuild {
  const content = starterContent({ siteTitle: site.title, media, now })
  return {
    form: createFormSchema.parse(content.form),
    postType: createPostTypeSchema.parse(content.postType),
    categories: content.categories.map((category) => ({
      key: category.key,
      input: createCategorySchema.parse(category.input),
    })),
    posts: content.posts.map((post) => ({
      categoryKey: post.category,
      input: postContentSchema.parse(post.input),
    })),
    pages: content.pages.map((page) => createPageSchema.parse(page)),
    themeSettings: {
      theme: site.theme,
      values: sectionValuesSchemaFor(themeSettingsFieldsByTheme[site.theme]).parse(
        content.themeSettings,
      ),
    },
    siteDescription: content.siteDescription,
  }
}

/**
 * Create the starter site, skipping anything whose slug or path is already
 * taken, and record what was created in the `starter` setting.
 */
export async function installStarter(
  kanso: Kanso,
  options: InstallStarterOptions,
): Promise<StarterInstallResult> {
  const now = options.now ?? new Date()
  const site = await kanso.settings.site()
  const images = await Promise.all(
    STARTER_IMAGES.map(async (image) => ({
      name: image.name,
      alt: image.alt,
      bytes: await options.loadImage(image.name),
    })),
  )
  const outcome = await kanso.starter.install({
    images,
    authorId: options.userId,
    now,
    build: (media) => starterBuild(site, media as StarterMedia, now),
  })
  return { created: starterCounts(outcome.manifest), skipped: outcome.skipped }
}
