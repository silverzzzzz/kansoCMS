import type { Kanso } from '@kanso/core'
import {
  absoluteUrl,
  buildBlogPosting,
  buildBreadcrumb,
  buildOrganization,
  buildWebPage,
  buildWebSite,
} from '@kanso/seo'
import type { Context } from 'hono'
import { raw } from 'hono/html'
import type { AppEnv } from '../env.ts'
import { loadSiteContext, type SiteRequestContext } from './context.ts'
import { Layout } from './themes/default/layout.tsx'
import { PostArticle } from './themes/default/post.tsx'

type Page = Awaited<ReturnType<Kanso['pages']['get']>>
type Post = Awaited<ReturnType<Kanso['posts']['getWithRelations']>>
type PostType = Awaited<ReturnType<Kanso['postTypes']['get']>>

interface RenderOptions {
  preview?: boolean
  /** Reuse a context the caller already loaded instead of querying again. */
  ctx?: SiteRequestContext
}

export async function renderPage(c: Context<AppEnv>, page: Page, options: RenderOptions = {}) {
  const ctx = options.ctx ?? (await loadSiteContext(c.var.kanso, c.env.SITE_URL))
  const isHome = page.path === 'home'
  const ownPath = isHome ? '/' : `/${page.path}`
  const ogMedia = page.ogMediaId ? await c.var.kanso.media.find(page.ogMediaId) : null
  const canonical =
    options.preview || !page.canonicalUrl ? absoluteUrl(ctx.origin, ownPath) : page.canonicalUrl
  const ogImage = ogMedia ? absoluteUrl(ctx.origin, ogMedia.url) : null
  const meta = isHome
    ? ctx.meta({
        title: page.seoTitle ?? null,
        path: '/',
        canonical,
        ogImage,
        ...(options.preview ? { noindex: true } : {}),
      })
    : ctx.meta({
        title: page.seoTitle ?? page.title,
        path: ownPath,
        description: page.seoDescription ?? page.excerpt ?? ctx.site.description ?? '',
        canonical,
        ogImage,
        noindex: options.preview || page.noindex,
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
        { name: page.title, url: meta.canonical },
      ]),
    )
  }

  return c.html(
    <Layout meta={meta} jsonLd={jsonLd} nav={ctx.nav}>
      {isHome ? (
        <article class="page">{raw(page.bodyHtml)}</article>
      ) : (
        <article class="page">
          <h1>{page.title}</h1>
          {raw(page.bodyHtml)}
        </article>
      )}
    </Layout>,
  )
}

export async function renderPost(
  c: Context<AppEnv>,
  post: Post,
  type: PostType,
  options: RenderOptions = {},
) {
  const ctx = options.ctx ?? (await loadSiteContext(c.var.kanso, c.env.SITE_URL))
  const ownUrl = absoluteUrl(ctx.origin, `/${type.slug}/${post.slug}`)
  const image = post.ogMediaUrl ?? post.coverMedia?.url ?? null
  const meta = ctx.meta({
    title: post.seoTitle ?? post.title,
    path: `/${type.slug}/${post.slug}`,
    description: post.seoDescription ?? post.excerpt ?? ctx.site.description ?? '',
    canonical: options.preview || !post.canonicalUrl ? ownUrl : post.canonicalUrl,
    ogType: 'article',
    ogImage: image ? absoluteUrl(ctx.origin, image) : null,
    noindex: options.preview || post.noindex,
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

  return c.html(
    <Layout meta={meta} jsonLd={jsonLd} nav={ctx.nav}>
      <PostArticle post={post} typeSlug={type.slug} formatDate={ctx.formatDate} />
    </Layout>,
  )
}
