import type { R2Bucket } from '@cloudflare/workers-types'
import {
  type CreateCategoryInput,
  type CreateFormInput,
  type CreatePageInput,
  type CreatePostTypeInput,
  isReservedSlug,
  mediaUrl,
  type PageSection,
  SETTINGS_KEYS,
  type StarterCounts,
  type StarterItemKind,
  type StarterKeptReason,
  type StarterManifest,
  siteSettingsSchema,
  starterCounts,
  type ThemeName,
  themeSettingsSchema,
} from '@kanso/shared'
import { and, count, eq, inArray, isNotNull, notInArray, or, type SQL, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import {
  categories,
  formSubmissions,
  forms,
  media,
  pages,
  postCategories,
  posts,
  postTypes,
  revisions,
  settings,
} from '../db/schema/index.ts'
import { isUniqueViolation, KansoError } from '../errors.ts'
import { formInsertValues } from './forms.ts'
import { prepareMediaObject } from './media.ts'
import { pageInsertValues } from './pages.ts'
import { postTypeInsertValues } from './post-types.ts'
import { type PostContentInput, postInsertValues } from './posts.ts'
import { settingsService } from './settings.ts'
import { categoryInsertValues } from './taxonomies.ts'

/*
 * The starter site is written with a handful of set-based reads and batched
 * writes instead of the per-item services: Workers Free allows 50 D1 queries
 * per invocation, and going through `pages.create` & co. costs ~80 for the
 * whole site. Row values still come from the services' insert builders.
 */

export type StarterSkippedKind = 'page' | 'postType' | 'form'
export interface StarterSkipped {
  kind: StarterSkippedKind
  slug: string
}

export interface StarterImage {
  name: string
  bytes: ArrayBuffer
  alt: string
}
export type StarterMediaRefs = Record<string, { id: number; url: string }>

export interface StarterBuild {
  form: CreateFormInput
  postType: CreatePostTypeInput
  categories: { key: string; input: CreateCategoryInput }[]
  posts: { categoryKey: string; input: PostContentInput }[]
  /** Top-level pages only. */
  pages: CreatePageInput[]
  /** Written into this theme's namespace only while that namespace is empty. */
  themeSettings: { theme: ThemeName; values: Record<string, unknown> }
  /** Written only while the site description is empty. */
  siteDescription: string
}

export interface StarterInstallPlan {
  images: StarterImage[]
  /** Builds the content once the uploaded images have ids and URLs. */
  build: (media: StarterMediaRefs) => StarterBuild
  authorId: number | null
  now?: Date
}

export interface StarterInstallOutcome {
  manifest: StarterManifest
  skipped: StarterSkipped[]
}

export type StarterKeptKind = 'page' | 'post' | 'postType' | 'category' | 'form' | 'media'
export interface StarterKept {
  kind: StarterKeptKind
  id: number
  title: string
  reason: StarterKeptReason
}

export interface StarterRemoval {
  removed: StarterCounts
  kept: StarterKept[]
}

export interface StarterTaken {
  /** Paths of existing pages (top-level page paths equal their slug). */
  pagePaths: ReadonlySet<string>
  postTypeSlugs: ReadonlySet<string>
  formSlugs: ReadonlySet<string>
}

/**
 * Decide what to create. A top-level page and a post type share the URL
 * namespace, so either kind of existing item blocks a slug for both.
 */
export function planStarterInstall(build: StarterBuild, taken: StarterTaken) {
  const reserved = [...build.pages.map((page) => page.slug), build.postType.slug].filter(
    isReservedSlug,
  )
  if (reserved.length > 0) {
    throw KansoError.validation(`Starter slugs are reserved: ${reserved.join(', ')}`)
  }

  const skipped: StarterSkipped[] = []
  const urlTaken = (slug: string) => taken.pagePaths.has(slug) || taken.postTypeSlugs.has(slug)

  const form = taken.formSlugs.has(build.form.slug) ? null : build.form
  if (!form) skipped.push({ kind: 'form', slug: build.form.slug })

  const postType = urlTaken(build.postType.slug) ? null : build.postType
  if (!postType) skipped.push({ kind: 'postType', slug: build.postType.slug })

  const pagesToCreate = build.pages.filter((page) => {
    if (!urlTaken(page.slug)) return true
    skipped.push({ kind: 'page', slug: page.slug })
    return false
  })

  return { form, postType, pages: pagesToCreate, skipped }
}

/**
 * Media ids still referenced by content that stays. Section values are
 * scanned conservatively: any top-level number equal to a candidate id
 * counts, which can keep an image but never deletes one in use.
 */
export function referencedMediaIds(input: {
  candidates: { id: number; r2Key: string }[]
  direct: (number | null)[]
  sections: (PageSection[] | null)[]
  bodies: unknown[]
}): Set<number> {
  const ids = new Set(input.candidates.map((item) => item.id))
  const referenced = new Set<number>()
  for (const id of input.direct) {
    if (id !== null && ids.has(id)) referenced.add(id)
  }
  for (const sectionList of input.sections) {
    for (const section of sectionList ?? []) {
      for (const value of Object.values(section.settings)) {
        if (typeof value === 'number' && ids.has(value)) referenced.add(value)
      }
    }
  }
  const bodyText = input.bodies.map((body) => JSON.stringify(body ?? null)).join('\n')
  for (const item of input.candidates) {
    if (bodyText.includes(mediaUrl(item.r2Key))) referenced.add(item.id)
  }
  return referenced
}

/** JSON.stringify with sorted object keys, for order-insensitive comparison. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

type BatchItem = Parameters<Db['batch']>[0][number]

export function starterService(db: Db, bucket: R2Bucket) {
  const settingsStore = settingsService(db)

  async function runBatch(statements: BatchItem[]) {
    const [first, ...rest] = statements
    if (!first) return []
    return db.batch([first, ...rest])
  }

  function upsertSetting(key: string, value: unknown) {
    return db
      .insert(settings)
      .values({ key, valueJson: value })
      .onConflictDoUpdate({ target: settings.key, set: { valueJson: value } })
  }

  /** A JSON array of ids selected by `query`, embedded as JSON inside `json_object`. */
  function idsJson(query: SQL): SQL {
    return sql`json((select json_group_array(id) from (${query})))`
  }

  async function install(plan: StarterInstallPlan): Promise<StarterInstallOutcome> {
    if (await settingsStore.starter()) {
      throw KansoError.conflict('Starter content is already installed')
    }
    const now = plan.now ?? new Date()

    // Images go to R2 first, then every media row in one batch.
    const prepared = plan.images.map((image) => ({
      name: image.name,
      bytes: image.bytes,
      object: prepareMediaObject({ bytes: image.bytes, filename: image.name, alt: image.alt }),
    }))
    const r2Keys: string[] = []
    const mediaIds: number[] = []
    const discardMedia = async () => {
      if (mediaIds.length > 0) {
        await db
          .delete(media)
          .where(inArray(media.id, mediaIds))
          .catch(() => undefined)
      }
      await Promise.all(r2Keys.map((key) => bucket.delete(key).catch(() => undefined)))
    }

    const refs: StarterMediaRefs = {}
    try {
      for (const item of prepared) {
        await bucket.put(item.object.r2Key, item.bytes, {
          httpMetadata: { contentType: item.object.mime },
        })
        r2Keys.push(item.object.r2Key)
      }
      const results = (await runBatch(
        prepared.map((item) =>
          db.insert(media).values(item.object.values).returning({ id: media.id }),
        ),
      )) as { id: number }[][]
      prepared.forEach((item, index) => {
        const row = results[index]?.[0]
        if (!row) throw new Error('Media insert did not return a row')
        mediaIds.push(row.id)
        refs[item.name] = { id: row.id, url: mediaUrl(item.object.r2Key) }
      })
    } catch (error) {
      await discardMedia()
      throw error
    }

    try {
      const build = plan.build(refs)
      const candidates = [
        ...new Set([...build.pages.map((page) => page.slug), build.postType.slug]),
      ]
      const [takenPages, takenTypes, takenForms, site, themes] = await Promise.all([
        db.select({ path: pages.path }).from(pages).where(inArray(pages.path, candidates)),
        db
          .select({ slug: postTypes.slug })
          .from(postTypes)
          .where(inArray(postTypes.slug, candidates)),
        db.select({ slug: forms.slug }).from(forms).where(eq(forms.slug, build.form.slug)),
        settingsStore.site(),
        settingsStore.theme(),
      ])
      const decision = planStarterInstall(build, {
        pagePaths: new Set(takenPages.map((row) => row.path)),
        postTypeSlugs: new Set(takenTypes.map((row) => row.slug)),
        formSlugs: new Set(takenForms.map((row) => row.slug)),
      })

      const statements: BatchItem[] = []
      if (decision.form) statements.push(db.insert(forms).values(formInsertValues(decision.form)))

      const typeSlug = decision.postType?.slug ?? null
      const postTypeId = sql<number>`(select id from post_types where slug = ${typeSlug})`
      if (decision.postType) {
        statements.push(db.insert(postTypes).values(postTypeInsertValues(decision.postType)))
        for (const category of build.categories) {
          statements.push(
            db.insert(categories).values({ postTypeId, ...categoryInsertValues(category.input) }),
          )
        }
        for (const post of build.posts) {
          statements.push(
            db.insert(posts).values({
              postTypeId,
              ...postInsertValues(
                post.input,
                { allowRawHtml: false, authorId: plan.authorId },
                now,
              ),
            }),
          )
          const category = build.categories.find((item) => item.key === post.categoryKey)
          if (category) {
            // drizzle's D1 batch cannot run `db.run(sql)` items with parameters,
            // so raw SQL goes through query builders (insert-select, SQL values).
            statements.push(
              db.insert(postCategories).select(
                sql`select p.id, c.id from posts p join categories c on c.post_type_id = p.post_type_id
                  where p.post_type_id = ${postTypeId} and p.slug = ${post.input.slug}
                    and c.slug = ${category.input.slug}`,
              ),
            )
          }
        }
      }

      for (const page of decision.pages) {
        statements.push(
          db.insert(pages).values(pageInsertValues(page, page.slug, { allowRawHtml: false }, now)),
        )
      }

      const theme = build.themeSettings.theme
      const currentThemeSettings = themes[theme]
      const writeThemeSettings =
        !currentThemeSettings || Object.keys(currentThemeSettings).length === 0
      if (writeThemeSettings) {
        statements.push(
          upsertSetting(
            SETTINGS_KEYS.theme,
            themeSettingsSchema.parse({ ...themes, [theme]: build.themeSettings.values }),
          ),
        )
      }
      const writeDescription = site.description.trim() === ''
      if (writeDescription) {
        statements.push(
          upsertSetting(
            SETTINGS_KEYS.site,
            siteSettingsSchema.parse({ ...site, description: build.siteDescription }),
          ),
        )
      }

      // The manifest lands in the same transaction, with ids resolved by slug.
      // A plain insert: a concurrent install hits the primary key and rolls back.
      const pagePaths = decision.pages.map((page) => page.slug)
      const emptyIds = sql`json('[]')`
      statements.push(
        db.insert(settings).values({
          key: SETTINGS_KEYS.starter,
          valueJson: sql`json_object(
          'installedAt', ${now.toISOString()},
          'pages', ${
            pagePaths.length > 0
              ? idsJson(
                  sql`select id from pages where path in (${sql.join(
                    pagePaths.map((path) => sql`${path}`),
                    sql`, `,
                  )}) order by id`,
                )
              : emptyIds
          },
          'posts', ${
            decision.postType
              ? idsJson(sql`select id from posts where post_type_id = ${postTypeId} order by id`)
              : emptyIds
          },
          'postTypes', ${
            decision.postType
              ? idsJson(sql`select id from post_types where slug = ${typeSlug}`)
              : emptyIds
          },
          'categories', ${
            decision.postType
              ? idsJson(
                  sql`select id from categories where post_type_id = ${postTypeId} order by id`,
                )
              : emptyIds
          },
          'tags', ${emptyIds},
          'forms', ${
            decision.form
              ? idsJson(sql`select id from forms where slug = ${decision.form.slug}`)
              : emptyIds
          },
          'media', json(${JSON.stringify(mediaIds)}),
          'themeSettings', ${
            writeThemeSettings ? sql`json(${JSON.stringify(build.themeSettings)})` : sql`null`
          },
          'siteDescription', ${writeDescription ? build.siteDescription : null}
        )`,
        }),
      )

      await runBatch(statements)
      const manifest = await settingsStore.starter()
      if (!manifest) throw new Error('Starter manifest was not written')
      return { manifest, skipped: decision.skipped }
    } catch (error) {
      await discardMedia()
      if (isUniqueViolation(error)) {
        throw KansoError.conflict('Starter content conflicts with a concurrent change; try again')
      }
      throw error
    }
  }

  async function remove(): Promise<StarterRemoval> {
    const manifest = await settingsStore.starter()
    if (!manifest) throw KansoError.notFound('Starter content')

    const kept: StarterKept[] = []
    const none = [0] // ids are positive, so this matches nothing in `in`/`not in`
    const listOr = (ids: number[]) => (ids.length > 0 ? ids : none)

    const [pageRows, postRows, editedRows, childRows] = await Promise.all([
      db
        .select({ id: pages.id, title: pages.title })
        .from(pages)
        .where(inArray(pages.id, listOr(manifest.pages))),
      db
        .select({ id: posts.id, title: posts.title })
        .from(posts)
        .where(inArray(posts.id, listOr(manifest.posts))),
      db
        .selectDistinct({ targetType: revisions.targetType, targetId: revisions.targetId })
        .from(revisions)
        .where(
          or(
            and(
              eq(revisions.targetType, 'page'),
              inArray(revisions.targetId, listOr(manifest.pages)),
            ),
            and(
              eq(revisions.targetType, 'post'),
              inArray(revisions.targetId, listOr(manifest.posts)),
            ),
          ),
        ),
      db
        .selectDistinct({ parentId: pages.parentId })
        .from(pages)
        .where(
          and(
            inArray(pages.parentId, listOr(manifest.pages)),
            notInArray(pages.id, listOr(manifest.pages)),
          ),
        ),
    ])
    const edited = new Set(editedRows.map((row) => `${row.targetType}:${row.targetId}`))
    const withChildren = new Set(childRows.map((row) => row.parentId))

    const deletePosts: number[] = []
    for (const post of postRows) {
      if (edited.has(`post:${post.id}`)) {
        kept.push({ kind: 'post', id: post.id, title: post.title, reason: 'edited' })
      } else deletePosts.push(post.id)
    }
    const deletePages: number[] = []
    for (const page of pageRows) {
      if (edited.has(`page:${page.id}`)) {
        kept.push({ kind: 'page', id: page.id, title: page.title, reason: 'edited' })
      } else if (withChildren.has(page.id)) {
        kept.push({ kind: 'page', id: page.id, title: page.title, reason: 'has_children' })
      } else deletePages.push(page.id)
    }

    const [typeRows, remainingRows, categoryRows, usedCategoryRows, formRows, mediaRows] =
      await Promise.all([
        db
          .select({ id: postTypes.id, name: postTypes.name })
          .from(postTypes)
          .where(inArray(postTypes.id, listOr(manifest.postTypes))),
        db
          .select({ postTypeId: posts.postTypeId, value: count() })
          .from(posts)
          .where(
            and(
              inArray(posts.postTypeId, listOr(manifest.postTypes)),
              notInArray(posts.id, listOr(deletePosts)),
            ),
          )
          .groupBy(posts.postTypeId),
        db
          .select({ id: categories.id, name: categories.name, postTypeId: categories.postTypeId })
          .from(categories)
          .where(inArray(categories.id, listOr(manifest.categories))),
        db
          .selectDistinct({ categoryId: postCategories.categoryId })
          .from(postCategories)
          .where(
            and(
              inArray(postCategories.categoryId, listOr(manifest.categories)),
              notInArray(postCategories.postId, listOr(deletePosts)),
            ),
          ),
        db
          .select({
            id: forms.id,
            name: forms.name,
            createdAt: forms.createdAt,
            updatedAt: forms.updatedAt,
            submissions: sql<number>`(select count(*) from ${formSubmissions} where ${formSubmissions.formId} = ${forms.id})`,
          })
          .from(forms)
          .where(inArray(forms.id, listOr(manifest.forms))),
        db
          .select({ id: media.id, filename: media.filename, r2Key: media.r2Key })
          .from(media)
          .where(inArray(media.id, listOr(manifest.media))),
      ])

    const remainingByType = new Map(remainingRows.map((row) => [row.postTypeId, row.value]))
    const deleteTypes: number[] = []
    for (const type of typeRows) {
      if ((remainingByType.get(type.id) ?? 0) > 0) {
        kept.push({ kind: 'postType', id: type.id, title: type.name, reason: 'in_use' })
      } else deleteTypes.push(type.id)
    }
    const usedCategories = new Set(usedCategoryRows.map((row) => row.categoryId))
    const deleteCategories: number[] = []
    for (const category of categoryRows) {
      const typeStays = !deleteTypes.includes(category.postTypeId)
      if (typeStays && usedCategories.has(category.id)) {
        kept.push({ kind: 'category', id: category.id, title: category.name, reason: 'in_use' })
      } else deleteCategories.push(category.id)
    }
    const deleteForms: number[] = []
    for (const form of formRows) {
      if (Number(form.submissions) > 0) {
        kept.push({ kind: 'form', id: form.id, title: form.name, reason: 'has_submissions' })
      } else if (form.updatedAt.getTime() > form.createdAt.getTime()) {
        kept.push({ kind: 'form', id: form.id, title: form.name, reason: 'edited' })
      } else deleteForms.push(form.id)
    }

    // Media: anything still referenced by content that stays (sample or not) is kept.
    const mediaIds = mediaRows.map((row) => row.id)
    // instr(), not LIKE: D1 caps LIKE patterns at 50 bytes and a media URL is longer.
    const bodyMatch = (column: typeof pages.bodyJson | typeof posts.bodyJson) =>
      or(...mediaRows.map((row) => sql`instr(${column}, ${mediaUrl(row.r2Key)}) > 0`))
    const [pageRefs, postRefs, sectionRows, pageBodies, postBodies, site, organization, themes] =
      await Promise.all([
        db
          .select({ ogMediaId: pages.ogMediaId })
          .from(pages)
          .where(
            and(
              inArray(pages.ogMediaId, listOr(mediaIds)),
              notInArray(pages.id, listOr(deletePages)),
            ),
          ),
        db
          .select({ coverMediaId: posts.coverMediaId, ogMediaId: posts.ogMediaId })
          .from(posts)
          .where(
            and(
              or(
                inArray(posts.coverMediaId, listOr(mediaIds)),
                inArray(posts.ogMediaId, listOr(mediaIds)),
              ),
              notInArray(posts.id, listOr(deletePosts)),
            ),
          ),
        db
          .select({ sectionsJson: pages.sectionsJson })
          .from(pages)
          .where(and(isNotNull(pages.sectionsJson), notInArray(pages.id, listOr(deletePages)))),
        mediaRows.length > 0
          ? db
              .select({ bodyJson: pages.bodyJson })
              .from(pages)
              .where(and(bodyMatch(pages.bodyJson), notInArray(pages.id, listOr(deletePages))))
          : Promise.resolve([]),
        mediaRows.length > 0
          ? db
              .select({ bodyJson: posts.bodyJson })
              .from(posts)
              .where(and(bodyMatch(posts.bodyJson), notInArray(posts.id, listOr(deletePosts))))
          : Promise.resolve([]),
        settingsStore.site(),
        settingsStore.organization(),
        settingsStore.theme(),
      ])
    const referenced = referencedMediaIds({
      candidates: mediaRows,
      direct: [
        site.logoMediaId,
        site.ogImageMediaId,
        organization.logoMediaId,
        ...pageRefs.map((row) => row.ogMediaId),
        ...postRefs.flatMap((row) => [row.coverMediaId, row.ogMediaId]),
      ],
      sections: sectionRows.map((row) => row.sectionsJson),
      bodies: [...pageBodies, ...postBodies].map((row) => row.bodyJson),
    })
    const deleteMedia = mediaRows.filter((row) => !referenced.has(row.id))
    for (const row of mediaRows) {
      if (referenced.has(row.id)) {
        kept.push({ kind: 'media', id: row.id, title: row.filename, reason: 'in_use' })
      }
    }

    const statements: BatchItem[] = []
    if (deletePosts.length > 0)
      statements.push(db.delete(posts).where(inArray(posts.id, deletePosts)))
    if (deleteCategories.length > 0) {
      statements.push(db.delete(categories).where(inArray(categories.id, deleteCategories)))
    }
    if (deleteTypes.length > 0) {
      statements.push(db.delete(postTypes).where(inArray(postTypes.id, deleteTypes)))
    }
    if (deletePages.length > 0)
      statements.push(db.delete(pages).where(inArray(pages.id, deletePages)))
    if (deleteForms.length > 0)
      statements.push(db.delete(forms).where(inArray(forms.id, deleteForms)))
    if (deleteMedia.length > 0) {
      statements.push(
        db.delete(media).where(
          inArray(
            media.id,
            deleteMedia.map((row) => row.id),
          ),
        ),
      )
    }

    // Settings go back only if nobody changed them since install.
    const snapshot = manifest.themeSettings
    if (snapshot && stableJson(themes[snapshot.theme]) === stableJson(snapshot.values)) {
      const { [snapshot.theme]: _installed, ...others } = themes
      statements.push(upsertSetting(SETTINGS_KEYS.theme, themeSettingsSchema.parse(others)))
    }
    if (manifest.siteDescription !== null && site.description === manifest.siteDescription) {
      statements.push(
        upsertSetting(SETTINGS_KEYS.site, siteSettingsSchema.parse({ ...site, description: '' })),
      )
    }
    statements.push(db.delete(settings).where(eq(settings.key, SETTINGS_KEYS.starter)))

    await runBatch(statements)
    await Promise.all(deleteMedia.map((row) => bucket.delete(row.r2Key).catch(() => undefined)))

    const removed: Record<StarterItemKind, number[]> = {
      pages: deletePages,
      posts: deletePosts,
      postTypes: deleteTypes,
      categories: deleteCategories,
      tags: [],
      forms: deleteForms,
      media: deleteMedia.map((row) => row.id),
    }
    return { removed: starterCounts(removed), kept }
  }

  return { install, remove }
}

export type StarterService = ReturnType<typeof starterService>
