import { effectiveExcerpt, type Kanso } from '@kanso/core'
import {
  absoluteUrl,
  buildBlogPosting,
  buildBreadcrumb,
  buildOrganization,
  buildWebPage,
  buildWebSite,
} from '@kanso/seo'
import { extractToc, injectHeadingIds } from '@kanso/shared'
import type { Context } from 'hono'
import { raw } from 'hono/html'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from '../env.ts'
import { loadSiteContext, type SiteRequestContext } from './context.ts'
import { type FormState, prepareForms } from './forms.tsx'
import { withResponsiveImages } from './images.tsx'
import { preparePostFields, prepareSections, SectionsBody } from './sections.tsx'

type Page = Awaited<ReturnType<Kanso['pages']['get']>>
type Post = Awaited<ReturnType<Kanso['posts']['getWithRelations']>>
type PostType = Awaited<ReturnType<Kanso['postTypes']['get']>>

interface RenderOptions {
  preview?: boolean
  /** Reuse a context the caller already loaded instead of querying again. */
  ctx?: SiteRequestContext
  form?: FormState
  status?: ContentfulStatusCode
}

export async function renderPage(c: Context<AppEnv>, page: Page, options: RenderOptions = {}) {
  const ctx = options.ctx ?? (await loadSiteContext(c.var.kanso, c.env.SITE_URL))
  const isHome = page.path === 'home'
  const ownPath = isHome ? '/' : `/${page.path}`
  const sections = page.sectionsJson
    ? await prepareSections(c.var.kanso, ctx.theme, page.sectionsJson)
    : null
  const prepared = sections
    ? { html: '', scripts: [] as string[] }
    : await prepareForms(c, page.bodyHtml, ownPath, options.form, ctx.messages.form)
  const bodyHtml = await withResponsiveImages(c.var.kanso, prepared.html)
  const ogMedia = page.ogMediaId ? await c.var.kanso.media.find(page.ogMediaId) : null
  const ancestors =
    !isHome && page.parentId !== null ? await c.var.kanso.pages.listPublishedAncestors(page) : []
  const canonical =
    options.preview || !page.canonicalUrl ? absoluteUrl(ctx.origin, ownPath) : page.canonicalUrl
  const ogImage = ogMedia ? absoluteUrl(ctx.origin, ogMedia.url) : null
  const meta = isHome
    ? ctx.meta({
        title: page.seoTitle ?? null,
        path: '/',
        canonical,
        ogImage,
        noindex: options.preview || page.noindex,
        nofollow: options.preview || undefined,
      })
    : ctx.meta({
        title: page.seoTitle ?? page.title,
        path: ownPath,
        description: page.seoDescription || effectiveExcerpt(page) || ctx.site.description || '',
        canonical,
        ogImage,
        noindex: options.preview || page.noindex,
        nofollow: options.preview || undefined,
        publishedAt: page.publishedAt,
        updatedAt: page.updatedAt,
      })
  const jsonLd: unknown[] = [buildOrganization(ctx.site), buildWebSite(ctx.site)]

  if (!isHome) {
    jsonLd.push(
      buildWebPage(ctx.site, {
        url: meta.canonical,
        title: page.title,
        description: meta.description,
        publishedAt: page.publishedAt,
        updatedAt: page.updatedAt,
      }),
      buildBreadcrumb([
        { name: ctx.site.name, url: `${ctx.origin}/` },
        ...ancestors.map((ancestor) => ({
          name: ancestor.title,
          url: absoluteUrl(ctx.origin, ancestor.path === 'home' ? '/' : `/${ancestor.path}`),
        })),
        { name: page.title, url: meta.canonical },
      ]),
    )
  }

  const content = (
    <ctx.theme.Layout
      meta={meta}
      jsonLd={jsonLd}
      nav={ctx.nav}
      search={ctx.search}
      scripts={prepared.scripts}
      themeSettings={ctx.themeSettings}
      extras={ctx.siteExtras}
    >
      {sections ? (
        <SectionsBody sections={sections} formatDate={ctx.formatDate} />
      ) : isHome ? (
        <article class="page">{raw(bodyHtml)}</article>
      ) : (
        <article class="page">
          <h1>{page.title}</h1>
          {raw(bodyHtml)}
        </article>
      )}
    </ctx.theme.Layout>
  )
  return options.status === undefined ? c.html(content) : c.html(content, options.status)
}

export async function renderPost(
  c: Context<AppEnv>,
  post: Post,
  type: PostType,
  options: RenderOptions = {},
) {
  const ctx = options.ctx ?? (await loadSiteContext(c.var.kanso, c.env.SITE_URL))
  const ownPath = `/${type.slug}/${post.slug}`
  const ownUrl = absoluteUrl(ctx.origin, ownPath)
  const prepared = await prepareForms(c, post.bodyHtml, ownPath, options.form, ctx.messages.form)
  const bodyHtml = await withResponsiveImages(c.var.kanso, prepared.html)
  const [fields, related] = await Promise.all([
    preparePostFields(c.var.kanso, type.fieldsJson, post.fieldsJson),
    c.var.kanso.posts.listRelated({
      postTypeId: type.id,
      excludeId: post.id,
      categoryIds: post.categories.map((category) => category.id),
      tagIds: post.tags.map((tag) => tag.id),
    }),
  ])
  const toc = extractToc(post.bodyJson)
  const image = post.ogMediaUrl ?? post.coverMedia?.url ?? null
  const meta = ctx.meta({
    title: post.seoTitle ?? post.title,
    path: ownPath,
    description: post.seoDescription || effectiveExcerpt(post) || ctx.site.description || '',
    canonical: options.preview || !post.canonicalUrl ? ownUrl : post.canonicalUrl,
    ogType: 'article',
    ogImage: image ? absoluteUrl(ctx.origin, image) : null,
    noindex: options.preview || post.noindex,
    nofollow: options.preview || undefined,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    feed: {
      href: absoluteUrl(ctx.origin, `/${type.slug}/feed.xml`),
      title: `${type.name} | ${ctx.site.name}`,
    },
  })
  const jsonLd = [
    buildOrganization(ctx.site),
    buildWebSite(ctx.site),
    buildBlogPosting(ctx.site, {
      url: meta.canonical,
      title: post.title,
      description: meta.description,
      imageUrl: meta.ogImage,
      authorName: post.authorName,
      tags: post.tags.map((tag) => tag.name),
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
    }),
    buildBreadcrumb([
      { name: ctx.site.name, url: `${ctx.origin}/` },
      { name: type.name, url: absoluteUrl(ctx.origin, `/${type.slug}`) },
      { name: post.title, url: meta.canonical },
    ]),
  ]

  const content = (
    <ctx.theme.Layout
      meta={meta}
      jsonLd={jsonLd}
      nav={ctx.nav}
      search={ctx.search}
      scripts={prepared.scripts}
      themeSettings={ctx.themeSettings}
      extras={ctx.siteExtras}
    >
      <ctx.theme.PostArticle
        post={post}
        bodyHtml={injectHeadingIds(bodyHtml)}
        typeSlug={type.slug}
        formatDate={ctx.formatDate}
        fields={fields}
        toc={toc}
        related={related.items.map((item) => ({ ...item, href: `/${type.slug}/${item.slug}` }))}
        labels={ctx.messages.post}
      />
    </ctx.theme.Layout>
  )
  return options.status === undefined ? c.html(content) : c.html(content, options.status)
}
