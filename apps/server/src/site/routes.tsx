import { KansoError } from '@kanso/core'
import {
  absoluteUrl,
  buildBreadcrumb,
  buildCollectionPage,
  buildOrganization,
  buildWebSite,
} from '@kanso/seo'
import { POSTS_PER_PAGE } from '@kanso/shared'
import { type Context, Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { parseBody } from '../forms/body.ts'
import { submitForm } from '../forms/submit.ts'
import { resolveMessages } from '../i18n.ts'
import { siteCache } from '../middleware/cache.ts'
import { loadSiteContext, type SiteRequestContext } from './context.ts'
import { feedResponse, robotsResponse, sitemapResponse } from './feeds.ts'
import { draftValues, type FormState, formSlugsIn } from './forms.tsx'
import { preview } from './preview.tsx'
import { renderPage, renderPost } from './render.tsx'
import { Layout } from './themes/default/layout.tsx'
import { PostList } from './themes/default/post-list.tsx'

type PostType = Awaited<ReturnType<AppEnv['Variables']['kanso']['postTypes']['get']>>
type ArchiveTerm = { kind: 'category' | 'tag'; id: number; slug: string; name: string }
type Page = NonNullable<
  Awaited<ReturnType<AppEnv['Variables']['kanso']['pages']['findPublishedByPath']>>
>
type Post = NonNullable<Awaited<ReturnType<AppEnv['Variables']['kanso']['posts']['findPublished']>>>
type ContentResolution =
  | { kind: 'page'; page: Page }
  | { kind: 'post'; post: Post; type: PostType }
  | { kind: 'route'; type: PostType; segments: string[] }

export const site = new Hono<AppEnv>()

site.route('/preview', preview)
site.use('*', siteCache)
site.get('/sitemap.xml', sitemapResponse)
site.get('/robots.txt', robotsResponse)

site.get('/', async (c) => {
  const [ctx, home] = await Promise.all([
    loadSiteContext(c.var.kanso, c.env.SITE_URL),
    c.var.kanso.pages.findPublishedByPath('home'),
  ])
  if (home) return renderPage(c, home, { ctx })

  const type = ctx.homePostTypeSlug
    ? await c.var.kanso.postTypes.findBySlug(ctx.homePostTypeSlug)
    : null
  if (type) return renderArchive(c, ctx, type, '/', undefined, true)

  const meta = ctx.meta({ title: null, path: '/' })
  const jsonLd = [buildOrganization(ctx.site), buildWebSite(ctx.site)]
  const m = ctx.messages
  return c.html(
    <Layout meta={meta} jsonLd={jsonLd} nav={ctx.nav}>
      <section class="page">
        <h1>{ctx.site.name}</h1>
        <p>{m.home.running}</p>
        <p>
          {m.home.hintBefore}
          <code>home</code>
          {m.home.hintAfter}
        </p>
      </section>
    </Layout>,
  )
})

site.post('/', (c) => handleFormPost(c, 'home'))

site.get('/:path{.+}', async (c) => {
  const rawPath = c.req.param('path')
  const path = rawPath.replace(/\/+$/, '')
  if (path !== rawPath) {
    const url = new URL(c.req.url)
    url.pathname = `/${path}`
    return c.redirect(url.toString(), 301)
  }

  const resolved = await resolveContent(c, path)
  if (!resolved) return notFound(c)
  if (resolved.kind === 'page') return renderPage(c, resolved.page)
  if (resolved.kind === 'post') return renderPost(c, resolved.post, resolved.type)

  const { segments, type } = resolved

  if (segments.length === 1) {
    return renderArchive(
      c,
      await loadSiteContext(c.var.kanso, c.env.SITE_URL),
      type,
      `/${type.slug}`,
    )
  }
  if (segments.length === 2 && segments[1] === 'feed.xml') return feedResponse(c, type)
  if (segments.length === 3 && segments[1] === 'category') {
    const category = await c.var.kanso.taxonomies.findCategoryBySlug(type.id, segments[2] ?? '')
    if (!category) return notFound(c)
    return renderArchive(
      c,
      await loadSiteContext(c.var.kanso, c.env.SITE_URL),
      type,
      `/${type.slug}/category/${category.slug}`,
      { kind: 'category', ...category },
    )
  }
  if (segments.length === 3 && segments[1] === 'tag') {
    const tag = await c.var.kanso.taxonomies.findTagBySlug(segments[2] ?? '')
    if (!tag) return notFound(c)
    return renderArchive(
      c,
      await loadSiteContext(c.var.kanso, c.env.SITE_URL),
      type,
      `/${type.slug}/tag/${tag.slug}`,
      { kind: 'tag', ...tag },
    )
  }
  return notFound(c)
})

site.post('/:path{.+}', (c) => handleFormPost(c, c.req.param('path').replace(/\/+$/, '')))

async function resolveContent(c: Context<AppEnv>, path: string): Promise<ContentResolution | null> {
  const page = await c.var.kanso.pages.findPublishedByPath(path)
  if (page) return { kind: 'page', page }

  const segments = path.split('/')
  const type = await c.var.kanso.postTypes.findBySlug(segments[0] ?? '')
  if (!type) return null
  if (segments.length === 2 && segments[1] !== 'feed.xml') {
    const post = await c.var.kanso.posts.findPublished(type.id, segments[1] ?? '')
    return post ? { kind: 'post', post, type } : null
  }
  return { kind: 'route', type, segments }
}

function isFormError(value: unknown): value is { path: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

async function renderFormState(
  c: Context<AppEnv>,
  resolved: Extract<ContentResolution, { kind: 'page' | 'post' }>,
  form: FormState,
  status?: 422,
) {
  if (resolved.kind === 'page') {
    return renderPage(c, resolved.page, { form, status })
  }
  return renderPost(c, resolved.post, resolved.type, { form, status })
}

async function handleFormPost(c: Context<AppEnv>, path: string) {
  c.header('cache-control', 'no-store')
  const resolved = await resolveContent(c, path)
  if (!resolved || resolved.kind === 'route') return notFound(c)

  const raw = await parseBody(c.req.raw)
  const slug = typeof raw._form === 'string' ? raw._form : ''
  const bodyHtml = resolved.kind === 'page' ? resolved.page.bodyHtml : resolved.post.bodyHtml
  if (!formSlugsIn(bodyHtml).includes(slug)) return notFound(c)

  const form = await c.var.kanso.forms.findBySlug(slug)
  if (!form) return notFound(c)
  const { locale } = await c.var.kanso.settings.site()
  const messages = resolveMessages(locale)

  try {
    const result = await submitForm(c, form, raw, messages)
    if (result.redirectUrl) return c.redirect(result.redirectUrl, 303)
    return renderFormState(c, resolved, { slug, success: true })
  } catch (error) {
    if (!(error instanceof KansoError) || error.code !== 'validation') throw error
    const errors = Array.isArray(error.details)
      ? error.details.filter(isFormError)
      : [{ path: '', message: error.message }]
    return renderFormState(c, resolved, { slug, values: draftValues(form, raw), errors }, 422)
  }
}

function normalizedPage(c: Context<AppEnv>): number | Response {
  const url = new URL(c.req.url)
  if (!url.searchParams.has('page')) return 1
  const value = Number(url.searchParams.get('page'))
  if (Number.isInteger(value) && value >= 2) return value
  url.search = ''
  return c.redirect(url.toString(), 301)
}

function pagePath(basePath: string, page: number): string {
  return page === 1 ? basePath : `${basePath}?page=${page}`
}

async function renderArchive(
  c: Context<AppEnv>,
  ctx: SiteRequestContext,
  type: PostType,
  basePath: string,
  term?: ArchiveTerm,
  isHome = false,
) {
  const page = normalizedPage(c)
  if (page instanceof Response) return page
  const result = await c.var.kanso.posts.listPublished({
    postTypeId: type.id,
    page,
    perPage: POSTS_PER_PAGE,
    ...(term?.kind === 'category' ? { categoryId: term.id } : {}),
    ...(term?.kind === 'tag' ? { tagId: term.id } : {}),
  })
  const totalPages = Math.max(1, Math.ceil(result.total / POSTS_PER_PAGE))
  if (page > totalPages) return notFound(c)

  const heading =
    term?.kind === 'category'
      ? ctx.messages.archive.categoryHeading(term.name, type.name)
      : term?.kind === 'tag'
        ? ctx.messages.archive.tagHeading(term.name, type.name)
        : type.name
  const description = type.description ?? ctx.site.description ?? ''
  // Paginated pages canonicalise to themselves (`/?page=2`), including the home archive.
  const canonicalPath = pagePath(basePath, page)
  const feed = {
    href: absoluteUrl(ctx.origin, `/${type.slug}/feed.xml`),
    title: `${type.name} | ${ctx.site.name}`,
  }
  const meta = ctx.meta({
    title: heading,
    path: canonicalPath,
    description,
    prev: page > 1 ? absoluteUrl(ctx.origin, pagePath(basePath, page - 1)) : null,
    next: page < totalPages ? absoluteUrl(ctx.origin, pagePath(basePath, page + 1)) : null,
    feed,
  })
  const crumbs = [
    { name: ctx.site.name, url: `${ctx.origin}/` },
    { name: type.name, url: absoluteUrl(ctx.origin, `/${type.slug}`) },
  ]
  if (term) crumbs.push({ name: term.name, url: meta.canonical })
  const jsonLd = [
    buildOrganization(ctx.site),
    buildWebSite(ctx.site),
    buildCollectionPage(ctx.site, { url: meta.canonical, title: heading, description }),
    ...(isHome ? [] : [buildBreadcrumb(crumbs)]),
  ]

  return c.html(
    <Layout meta={meta} jsonLd={jsonLd} nav={ctx.nav}>
      <PostList
        heading={heading}
        description={description}
        items={result.items.map((post) => ({
          ...post,
          href: `/${type.slug}/${post.slug}`,
        }))}
        pagination={{ page, totalPages, basePath }}
        formatDate={ctx.formatDate}
        messages={ctx.messages.pagination}
      />
    </Layout>,
  )
}

async function notFound(c: Context<AppEnv>) {
  const ctx = await loadSiteContext(c.var.kanso, c.env.SITE_URL)
  const meta = ctx.meta({ title: ctx.messages.notFound.title, path: c.req.path, noindex: true })
  return c.html(
    <Layout meta={meta} nav={ctx.nav}>
      <section class="page">
        <h1>404</h1>
        <p>{ctx.messages.notFound.body}</p>
      </section>
    </Layout>,
    404,
  )
}
