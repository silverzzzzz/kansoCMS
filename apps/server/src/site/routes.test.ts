import { type Kanso, KansoError } from '@kanso/core'
import {
  DEFAULT_SUBMISSION_MESSAGES,
  type RichTextDoc,
  type SectionField,
  type SubmissionMessages,
  type SubmissionValues,
  submissionSchemaFor,
} from '@kanso/shared'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { site } from './routes.tsx'

vi.mock('../forms/notify.ts', () => ({
  notifySubmission: vi.fn().mockResolvedValue({ skipped: 'no_from' }),
}))

const fields = [
  {
    type: 'text' as const,
    name: 'name',
    label: 'Name',
    required: true,
    placeholder: null,
    help: null,
    maxLength: 200,
  },
]

const testForm = {
  id: 1,
  slug: 'contact-form',
  name: 'Contact form',
  fieldsJson: fields,
  notifyTo: '',
  successMessage: 'Thanks for getting in touch.',
  redirectUrl: null as string | null,
  turnstile: false,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  updatedAt: new Date('2026-09-15T00:00:00Z'),
}

const testPage = {
  id: 1,
  slug: 'contact',
  path: 'contact',
  parentId: null as number | null,
  sortOrder: 0,
  title: 'Contact',
  bodyJson: null as RichTextDoc | null,
  bodyHtml: '<p>Write to us.</p><div data-kanso-form="contact-form"></div>',
  excerpt: '' as string | null,
  status: 'published' as const,
  publishedAt: new Date('2026-09-15T00:00:00Z'),
  seoTitle: null,
  seoDescription: null,
  noindex: false,
  canonicalUrl: null,
  ogMediaId: null as number | null,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  updatedAt: new Date('2026-09-15T00:00:00Z'),
}

const testPostType = {
  id: 3,
  slug: 'blog',
  name: 'Blog',
  description: null as string | null,
  hasCategories: true,
  hasTags: true,
  noindex: false,
  fieldsJson: null as SectionField[] | null,
  sortOrder: 0,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  updatedAt: new Date('2026-09-15T00:00:00Z'),
}

/** Hydrated post row as returned by `posts.findPublished`. */
const testPost = {
  id: 9,
  postTypeId: 3,
  title: 'Hello world',
  slug: 'hello',
  bodyJson: null as RichTextDoc | null,
  bodyHtml: '<p>Post body.</p>',
  excerpt: 'An excerpt.',
  status: 'published' as const,
  publishedAt: new Date('2026-09-16T00:00:00Z'),
  pinned: false,
  fieldsJson: null as Record<string, unknown> | null,
  coverMediaId: null as number | null,
  authorId: null as number | null,
  seoTitle: null,
  seoDescription: null,
  noindex: false,
  canonicalUrl: null,
  ogMediaId: null as number | null,
  deletedAt: null as Date | null,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  updatedAt: new Date('2026-09-16T00:00:00Z'),
  categories: [] as { id: number; slug: string; name: string }[],
  tags: [] as { id: number; slug: string; name: string }[],
  authorName: null as string | null,
  authorSlug: null as string | null,
  coverMedia: null as {
    url: string
    alt: string | null
    width: number | null
    height: number | null
  } | null,
  ogMediaUrl: null as string | null,
}

function validateSubmission(
  form: Pick<typeof testForm, 'fieldsJson'>,
  raw: Record<string, unknown>,
  messages: SubmissionMessages = DEFAULT_SUBMISSION_MESSAGES,
): SubmissionValues {
  const result = submissionSchemaFor(form.fieldsJson, messages).safeParse(raw)
  if (!result.success) {
    throw KansoError.validation(
      'Invalid submission',
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    )
  }
  return result.data
}

function testSetup(
  options: {
    form?: typeof testForm
    page?: typeof testPage
    locale?: string
    theme?: string
    siteDescription?: string
    siteOgImageMediaId?: number
    siteLogoMediaId?: number
    siteNoindex?: boolean
    faviconMediaId?: number
    googleSiteVerification?: string
    headHtml?: string | null
    bodyEndHtml?: string | null
    robotsExtra?: string | null
    notFoundPageId?: number | null
    maintenance?: boolean
    maintenanceMessage?: string
    sessionUser?: { id: number; name: string } | null
    /** Row returned for `findPublishedByPath('home')`; undefined means no home page. */
    home?: typeof testPage
    postType?: typeof testPostType
    postTypes?: (typeof testPostType)[]
    /** Hydrated post returned for `findPublished(type.id, 'hello')`. */
    post?: typeof testPost
    sitemapPages?: { path: string; updatedAt: Date }[]
    sitemapPosts?: { postTypeId: number; slug: string; updatedAt: Date }[]
    categoryArchives?: { postTypeId: number; slug: string; updatedAt: Date }[]
    tagArchives?: { postTypeId: number; slug: string; updatedAt: Date }[]
    authorArchives?: { postTypeId: number; slug: string | null; updatedAt: Date }[]
    related?: { items: (typeof testPost)[] }
    author?: {
      id: number
      name: string
      slug: string
      bio: string | null
      avatar: { url: string; alt: string | null } | null
    } | null
    headerMenu?: {
      itemsJson: { label: string; href: string; children: { label: string; href: string }[] }[]
    } | null
    organization?: {
      name?: string
      logoMediaId?: number | null
      twitterHandle?: string
    }
    ancestors?: { id: number; parentId: number | null; path: string; title: string }[]
    redirect?: { to: string; status: 301 | 302 } | null
    shareTarget?: { targetType: 'page' | 'post'; targetId: number }
    custom404?: typeof testPage
    turnstileSiteKey?: string
    turnstileSecretKey?: string
  } = {},
) {
  const form = options.form ?? testForm
  const page = options.page ?? testPage
  const createSubmission = vi.fn().mockResolvedValue({ id: 10 })
  const search = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, perPage: 10 })
  const findByPath = vi.fn().mockResolvedValue(options.redirect ?? null)
  const kanso: Kanso = Object.assign(Object.create(null), {
    settings: {
      site: vi.fn().mockResolvedValue({
        title: 'Test site',
        description: options.siteDescription ?? '',
        locale: options.locale ?? 'en',
        timezone: 'UTC',
        logoMediaId: options.siteLogoMediaId ?? null,
        ogImageMediaId: options.siteOgImageMediaId ?? null,
        homePostTypeSlug: null,
        noindex: options.siteNoindex ?? false,
        faviconMediaId: options.faviconMediaId ?? null,
        googleSiteVerification: options.googleSiteVerification ?? '',
        headHtml: options.headHtml ?? null,
        bodyEndHtml: options.bodyEndHtml ?? null,
        robotsExtra: options.robotsExtra ?? null,
        notFoundPageId: options.notFoundPageId ?? null,
        maintenance: options.maintenance ?? false,
        maintenanceMessage: options.maintenanceMessage ?? '',
        theme: options.theme,
      }),
      organization: vi.fn().mockResolvedValue({
        name: '',
        url: null,
        logoMediaId: null,
        twitterHandle: '',
        sameAs: [],
        ...options.organization,
      }),
      theme: vi.fn().mockResolvedValue({}),
      forms: vi.fn().mockResolvedValue({
        fromEmail: '',
        fromName: '',
        notifyTo: '',
        turnstileSiteKey: options.turnstileSiteKey ?? '',
      }),
    },
    pages: {
      listPublishedTopLevel: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(page),
      findPublishedByPath: vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(path === 'home' ? options.home : path === page.path ? page : undefined),
        ),
      listPublishedAncestors: vi.fn().mockResolvedValue(options.ancestors ?? []),
      listPublishedForSitemap: vi.fn().mockResolvedValue(options.sitemapPages ?? []),
      findPublishedById: vi
        .fn()
        .mockImplementation((id: number) =>
          Promise.resolve(
            id === options.notFoundPageId && options.custom404 ? options.custom404 : undefined,
          ),
        ),
    },
    media: {
      find: vi
        .fn()
        .mockImplementation((id: number) => Promise.resolve({ id, url: `/media/${id}.png` })),
    },
    postTypes: {
      list: vi.fn().mockResolvedValue(options.postTypes ?? []),
      findBySlug: vi
        .fn()
        .mockImplementation((slug: string) =>
          Promise.resolve(options.postType?.slug === slug ? options.postType : undefined),
        ),
    },
    menus: {
      findBySlug: vi.fn().mockResolvedValue(options.headerMenu ?? null),
    },
    posts: {
      listPublished: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listRelated: vi.fn().mockResolvedValue(options.related ?? { items: [] }),
      listPublishedForSitemap: vi.fn().mockResolvedValue(options.sitemapPosts ?? []),
      listAuthorsForSitemap: vi.fn().mockResolvedValue(options.authorArchives ?? []),
      findPublished: vi
        .fn()
        .mockImplementation((_typeId: number, slug: string) =>
          Promise.resolve(options.post?.slug === slug ? options.post : undefined),
        ),
    },
    taxonomies: {
      listCategoryArchivesForSitemap: vi.fn().mockResolvedValue(options.categoryArchives ?? []),
      listTagArchivesForSitemap: vi.fn().mockResolvedValue(options.tagArchives ?? []),
    },
    redirects: { findByPath },
    search: { search },
    auth: {
      getSessionUser: vi.fn().mockResolvedValue(options.sessionUser ?? null),
      findAuthorBySlug: vi
        .fn()
        .mockImplementation((slug: string) =>
          Promise.resolve(options.author?.slug === slug ? options.author : null),
        ),
    },
    analytics: {
      recordView: vi.fn().mockResolvedValue(undefined),
      summary: vi.fn().mockResolvedValue({ daily: [], top: [] }),
    },
    shareLinks: {
      resolve: vi
        .fn()
        .mockImplementation(() =>
          options.shareTarget
            ? Promise.resolve(options.shareTarget)
            : Promise.reject(KansoError.notFound('Share link')),
        ),
    },
    forms: {
      findBySlug: vi
        .fn()
        .mockImplementation((slug: string) =>
          Promise.resolve(slug === form.slug ? form : undefined),
        ),
      validateSubmission: vi.fn(validateSubmission),
      submissions: { create: createSubmission },
    },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .onError(onError)
    .route('/', site)
  const env = {
    SITE_URL: 'https://example.com',
    ...(options.turnstileSecretKey ? { TURNSTILE_SECRET_KEY: options.turnstileSecretKey } : {}),
  } as Bindings
  const executionCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  }
  return { app, createSubmission, findByPath, search, env, executionCtx, kanso }
}

describe('site page metadata', () => {
  const bodyJson: RichTextDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Body derived description.' }],
      },
    ],
  }

  it('derives the page meta description from the body when the excerpt is missing', async () => {
    const { app, env, executionCtx } = testSetup({
      page: { ...testPage, excerpt: null, bodyJson },
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta name="description" content="Body derived description."/>')
  })

  it('prefers a non-blank stored excerpt for the page meta description', async () => {
    const { app, env, executionCtx } = testSetup({
      page: { ...testPage, excerpt: '  Stored description.  ', bodyJson },
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta name="description" content="Stored description."/>')
    expect(html).not.toContain('<meta name="description" content="Body derived description."/>')
  })

  it('emits og:locale in language_TERRITORY form for a bare language tag', async () => {
    const { app, env, executionCtx } = testSetup({ locale: 'ja' })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta property="og:locale" content="ja_JP"/>')
  })

  it('emits no og:image when neither the page nor the site sets one', async () => {
    const { app, env, executionCtx } = testSetup()
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).not.toContain('og:image')
    expect(html).toContain('<meta name="twitter:card" content="summary"/>')
  })

  it('falls back to the site-wide OG image when the page has none', async () => {
    const { app, env, executionCtx } = testSetup({ siteOgImageMediaId: 9 })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta property="og:image" content="https://example.com/media/9.png"/>')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>')
  })

  it('prefers the page OG image over the site-wide default', async () => {
    const { app, env, executionCtx } = testSetup({
      siteOgImageMediaId: 9,
      page: { ...testPage, ogMediaId: 7 },
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta property="og:image" content="https://example.com/media/7.png"/>')
    expect(html).not.toContain('/media/9.png')
  })

  it('emits twitter:site from the organisation X handle', async () => {
    const { app, env, executionCtx } = testSetup({
      organization: { twitterHandle: 'kansocms' },
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta name="twitter:site" content="@kansocms"/>')
  })

  it('uses the organisation logo in the Organization JSON-LD', async () => {
    const { app, env, executionCtx } = testSetup({
      organization: { name: 'Example Inc.', logoMediaId: 4 },
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('"@type":"Organization"')
    expect(html).toContain('"logo":"https://example.com/media/4.png"')
  })

  it('falls back to the site logo for the Organization JSON-LD', async () => {
    const { app, env, executionCtx } = testSetup({
      siteLogoMediaId: 3,
      organization: { name: 'Example Inc.' },
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('"logo":"https://example.com/media/3.png"')
  })

  it('includes published ancestors in the page breadcrumb', async () => {
    const { app, env, executionCtx } = testSetup({
      page: { ...testPage, slug: 'team', path: 'company/team', parentId: 2, title: 'Team' },
      ancestors: [{ id: 2, parentId: null, path: 'company', title: 'About' }],
    })
    const response = await app.request('/company/team', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain(
      '"@type":"BreadcrumbList","itemListElement":[' +
        '{"@type":"ListItem","position":1,"name":"Test site","item":"https://example.com/"},' +
        '{"@type":"ListItem","position":2,"name":"About","item":"https://example.com/company"},' +
        '{"@type":"ListItem","position":3,"name":"Team","item":"https://example.com/company/team"}' +
        ']}',
    )
  })
})

describe('site form routes', () => {
  it('renders an embedded form on a published page without a Turnstile script', async () => {
    const { app, env, executionCtx } = testSetup()
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<form method="post" action="/contact"')
    expect(html).not.toContain('challenges.cloudflare.com/turnstile/v0/api.js')
  })

  it('renders the Japanese submit label for a Japanese site', async () => {
    const { app, env, executionCtx } = testSetup({ locale: 'ja' })
    const response = await app.request('/contact', undefined, env, executionCtx)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<button type="submit">送信</button>')
  })

  it('loads the Turnstile widget and script only for a configured enabled form', async () => {
    const { app, env, executionCtx } = testSetup({
      form: { ...testForm, turnstile: true },
      turnstileSiteKey: 'site-key',
      turnstileSecretKey: 'secret-key',
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<div class="cf-turnstile" data-sitekey="site-key"></div>')
    expect(html).toContain(
      '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async="" defer=""></script>',
    )
  })

  it('re-renders required-field errors with status 422 and no-store', async () => {
    const { app, env, executionCtx } = testSetup()
    const response = await app.request(
      '/contact',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '_form=contact-form&name=',
      },
      env,
      executionCtx,
    )

    expect(response.status).toBe(422)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain('This field is required')
  })

  it('re-renders Japanese required-field errors for a Japanese site', async () => {
    const { app, env, executionCtx } = testSetup({ locale: 'ja' })
    const response = await app.request(
      '/contact',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '_form=contact-form&name=',
      },
      env,
      executionCtx,
    )

    expect(response.status).toBe(422)
    expect(await response.text()).toContain('必須項目です')
  })

  it('stores a valid submission and renders the success message', async () => {
    const { app, createSubmission, env, executionCtx } = testSetup()
    const response = await app.request(
      '/contact',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '_form=contact-form&name=Alice',
      },
      env,
      executionCtx,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain('Thanks for getting in touch.')
    expect(createSubmission).toHaveBeenCalledOnce()
  })

  it('redirects a valid submission with status 303', async () => {
    const redirectForm = { ...testForm, redirectUrl: '/thanks' }
    const { app, env, executionCtx } = testSetup({ form: redirectForm })
    const response = await app.request(
      '/contact',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '_form=contact-form&name=Alice',
      },
      env,
      executionCtx,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/thanks')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 404 when the submitted form is not embedded in the page', async () => {
    const { app, createSubmission, env, executionCtx } = testSetup()
    const response = await app.request(
      '/contact',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '_form=another-form&name=Alice',
      },
      env,
      executionCtx,
    )

    expect(response.status).toBe(404)
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('returns 404 when posting to an unknown path', async () => {
    const { app, createSubmission, env, executionCtx } = testSetup()
    const response = await app.request('/missing', { method: 'POST' }, env, executionCtx)

    expect(response.status).toBe(404)
    expect(createSubmission).not.toHaveBeenCalled()
  })
})

describe('site not found page', () => {
  it('renders the Japanese message for a Japanese site', async () => {
    const { app, env, executionCtx } = testSetup({ locale: 'ja' })
    const response = await app.request('/missing', undefined, env, executionCtx)

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('お探しのページは見つかりませんでした。')
  })

  it('falls back to the English message for an unsupported locale', async () => {
    const { app, env, executionCtx } = testSetup({ locale: 'fr' })
    const response = await app.request('/missing', undefined, env, executionCtx)

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Page not found.')
  })
})

describe('site redirects', () => {
  it('redirects a missing path to an internal target with status 301', async () => {
    const { app, env, executionCtx, findByPath } = testSetup({
      redirect: { to: '/new', status: 301 },
    })
    const response = await app.request('/old', undefined, env, executionCtx)

    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('/new')
    expect(findByPath).toHaveBeenCalledWith('old')
  })

  it('redirects a missing path to an external target with status 302', async () => {
    const { app, env, executionCtx } = testSetup({
      redirect: { to: 'https://example.com/', status: 302 },
    })
    const response = await app.request('/old', undefined, env, executionCtx)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/')
  })

  it('prefers existing content over a redirect', async () => {
    const { app, env, executionCtx, findByPath } = testSetup({
      redirect: { to: '/new', status: 301 },
    })
    const response = await app.request('/contact', undefined, env, executionCtx)

    expect(response.status).toBe(200)
    expect(findByPath).not.toHaveBeenCalled()
  })

  it('keeps returning 404 when no redirect exists', async () => {
    const { app, env, executionCtx, findByPath } = testSetup()
    const response = await app.request('/unknown', undefined, env, executionCtx)

    expect(response.status).toBe(404)
    expect(findByPath).toHaveBeenCalledWith('unknown')
  })
})

describe('site search', () => {
  it.each(['/search', '/search?q=%20', `/search?q=${'a'.repeat(101)}`])(
    'renders only the search form for %s',
    async (url) => {
      const { app, search, env, executionCtx } = testSetup()
      const response = await app.request(url, undefined, env, executionCtx)
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(html).toContain('role="search" action="/search" method="get"')
      expect(html).toContain('name="robots" content="noindex, follow"')
      expect(html).toContain('rel="canonical" href="https://example.com/search"')
      expect(html).not.toContain('No results.')
      expect(html).not.toContain('application/ld+json')
      expect(search).not.toHaveBeenCalled()
    },
  )

  it('renders links, dates, counts and escaped highlights with query-preserving pagination', async () => {
    const { app, search, env, executionCtx } = testSetup()
    search.mockResolvedValue({
      total: 21,
      page: 2,
      perPage: 10,
      items: [
        {
          kind: 'post',
          id: 1,
          title: 'Search <title>',
          path: 'blog/hit',
          typeName: 'Blog',
          publishedAt: new Date('2026-09-15T00:00:00Z'),
          snippet: [
            { text: '<script>', hit: true },
            { text: ' & body', hit: false },
          ],
        },
      ],
    })
    const response = await app.request(
      '/search?q=hello%20%26%20world&page=2',
      undefined,
      env,
      executionCtx,
    )
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('<a href="/blog/hit">Search &lt;title&gt;</a>')
    expect(html).toContain('<mark>&lt;script&gt;</mark> &amp; body')
    expect(html).toContain('21 results')
    expect(html).toContain('Blog · ')
    expect(html).toContain('2026')
    expect(html).toContain('/search?q=hello%20%26%20world&amp;page=1')
    expect(html).toContain('/search?q=hello%20%26%20world&amp;page=3')
    expect(search).toHaveBeenCalledWith({ q: 'hello & world', page: 2, perPage: 10 })
  })

  it.each(['0', '-1', '1.5', 'bad', '1'])(
    'uses page 1 without redirecting page=%s',
    async (page) => {
      const { app, search, env, executionCtx } = testSetup()
      const response = await app.request(
        `/search?q=hello&page=${page}`,
        undefined,
        env,
        executionCtx,
      )
      expect(response.status).toBe(200)
      expect(search).toHaveBeenCalledWith({ q: 'hello', page: 1, perPage: 10 })
      expect(await response.text()).toContain('No results.')
    },
  )

  it('renders Japanese counts and page labels', async () => {
    const { app, search, env, executionCtx } = testSetup({ locale: 'ja' })
    search.mockResolvedValue({
      total: 1,
      page: 1,
      perPage: 10,
      items: [
        {
          kind: 'page',
          id: 1,
          title: '東京',
          path: 'tokyo',
          typeName: null,
          publishedAt: new Date('2026-09-15T00:00:00Z'),
          snippet: [{ text: '東京', hit: true }],
        },
      ],
    })
    const response = await app.request('/search?q=東京', undefined, env, executionCtx)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('1 件')
    expect(html).toContain('ページ · ')
    expect(html).toContain('<mark>東京</mark>')
  })

  it('returns 404 for pages beyond a nonempty result set', async () => {
    const { app, search, env, executionCtx } = testSetup()
    search.mockResolvedValue({ items: [], total: 1, page: 2, perPage: 10 })
    const response = await app.request('/search?q=hello&page=2', undefined, env, executionCtx)
    expect(response.status).toBe(404)
  })

  it('keeps an empty result set at 200 even on a later page', async () => {
    const { app, env, executionCtx } = testSetup({ locale: 'ja' })
    const response = await app.request('/search?q=missing&page=2', undefined, env, executionCtx)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('該当する結果はありません。')
  })
})

describe('site themes', () => {
  it('renders pages with the configured paper shell and shared form', async () => {
    const { app, env, executionCtx } = testSetup({ theme: 'paper' })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('href="/themes/paper.css"')
    expect(html).toContain('class="theme-paper"')
    expect(html).toContain('site-header--paper')
    expect(html).not.toContain('class="site-tagline"')
  })

  it('shows the site description, not the page excerpt, as the paper tagline', async () => {
    const { app, env, executionCtx } = testSetup({
      theme: 'paper',
      siteDescription: 'Notes & <ideas>',
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(html).toContain('<p class="site-tagline">Notes &amp; &lt;ideas&gt;</p>')
    expect(html).not.toContain('<p class="site-tagline">Write to us.</p>')
    expect(html).toContain('role="search" action="/search"')
    expect(html).toContain('<form method="post" action="/contact"')
    expect(html).toContain('<footer class="site-footer"><nav class="site-nav">')
  })

  it.each([undefined, 'nope', 'constructor', '__proto__'])(
    'falls back for theme %s',
    async (theme) => {
      const { app, env, executionCtx } = testSetup({ theme })
      const response = await app.request('/contact', undefined, env, executionCtx)
      const html = await response.text()

      expect(response.status).toBe(200)
      expect(html).toContain('href="/themes/default.css"')
      expect(html).toContain('class="theme-default"')
    },
  )

  it.each([
    ['/', 200],
    ['/search?q=a', 200],
    ['/nothing-here', 404],
  ])('uses paper for %s', async (path, status) => {
    const { app, env, executionCtx } = testSetup({ theme: 'paper' })
    const response = await app.request(path, undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(status)
    expect(html).toContain('href="/themes/paper.css"')
    expect(html).toContain('class="theme-paper"')
    expect(html).toContain('site-header--paper')
    expect(html).toContain('role="search" action="/search"')
  })
})

describe('noindex output', () => {
  it('emits noindex, follow for a page the user marked noindex', async () => {
    const { app, env, executionCtx } = testSetup({ page: { ...testPage, noindex: true } })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(html).toContain('name="robots" content="noindex, follow"')
    expect(html).not.toContain('nofollow')
  })

  it('emits noindex on every page when site noindex is on', async () => {
    const { app, env, executionCtx } = testSetup({ siteNoindex: true })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(html).toContain('name="robots" content="noindex, follow"')
  })

  it('emits noindex, follow on a noindexed post type archive', async () => {
    const { app, env, executionCtx } = testSetup({
      postType: { ...testPostType, noindex: true },
    })
    const response = await app.request('/blog', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('name="robots" content="noindex, follow"')
  })

  it('emits no robots meta on an indexable archive', async () => {
    const { app, env, executionCtx } = testSetup({ postType: testPostType })
    const response = await app.request('/blog', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).not.toContain('name="robots"')
  })
})

describe('sitemap.xml', () => {
  const sitemapOptions = {
    postTypes: [testPostType],
    sitemapPages: [
      { path: 'home', updatedAt: new Date('2026-09-01T00:00:00Z') },
      { path: 'about', updatedAt: new Date('2026-09-02T00:00:00Z') },
    ],
    sitemapPosts: [{ postTypeId: 3, slug: 'hello', updatedAt: new Date('2026-09-10T00:00:00Z') }],
    categoryArchives: [
      { postTypeId: 3, slug: 'tech', updatedAt: new Date('2026-09-05T00:00:00Z') },
    ],
    tagArchives: [{ postTypeId: 3, slug: 'web', updatedAt: new Date('2026-09-06T00:00:00Z') }],
  }

  it('lists indexable pages, archives and posts with lastmod', async () => {
    const { app, env, executionCtx } = testSetup({
      ...sitemapOptions,
      home: { ...testPage, path: 'home', updatedAt: new Date('2026-09-01T00:00:00Z') },
    })
    const response = await app.request('/sitemap.xml', undefined, env, executionCtx)
    const xml = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/xml')
    expect(xml).toContain(
      '<url><loc>https://example.com/</loc><lastmod>2026-09-01T00:00:00.000Z</lastmod></url>',
    )
    expect(xml).toContain('<loc>https://example.com/about</loc>')
    expect(xml).toContain(
      '<url><loc>https://example.com/blog</loc><lastmod>2026-09-10T00:00:00.000Z</lastmod></url>',
    )
    expect(xml).toContain('<loc>https://example.com/blog/category/tech</loc>')
    expect(xml).toContain('<loc>https://example.com/blog/tag/web</loc>')
    expect(xml).toContain('<loc>https://example.com/blog/hello</loc>')
  })

  it('omits / when the home page is noindexed', async () => {
    const { app, env, executionCtx } = testSetup({
      ...sitemapOptions,
      home: { ...testPage, path: 'home', noindex: true },
    })
    const response = await app.request('/sitemap.xml', undefined, env, executionCtx)
    const xml = await response.text()

    expect(xml).not.toContain('<loc>https://example.com/</loc>')
    expect(xml).toContain('<loc>https://example.com/about</loc>')
    expect(xml).toContain('<loc>https://example.com/blog</loc>')
  })

  it('omits noindexed post type archives but keeps their posts', async () => {
    const { app, env, executionCtx } = testSetup({
      ...sitemapOptions,
      postTypes: [{ ...testPostType, noindex: true }],
    })
    const response = await app.request('/sitemap.xml', undefined, env, executionCtx)
    const xml = await response.text()

    expect(xml).not.toContain('<loc>https://example.com/blog</loc>')
    expect(xml).not.toContain('/category/tech')
    expect(xml).not.toContain('/tag/web')
    expect(xml).toContain('<loc>https://example.com/blog/hello</loc>')
  })

  it('returns an empty urlset when the site is noindexed', async () => {
    const { app, env, executionCtx } = testSetup({ ...sitemapOptions, siteNoindex: true })
    const response = await app.request('/sitemap.xml', undefined, env, executionCtx)
    const xml = await response.text()

    expect(response.status).toBe(200)
    expect(xml).not.toContain('<loc>')
  })
})

describe('header menu', () => {
  it('renders the header menu items with dropdown children instead of the generated nav', async () => {
    const { app, env, executionCtx } = testSetup({
      postType: testPostType,
      postTypes: [testPostType],
      headerMenu: {
        itemsJson: [
          { label: 'Docs', href: '/docs', children: [{ label: 'API', href: '/docs/api' }] },
          { label: 'GitHub', href: 'https://github.com/example/repo', children: [] },
        ],
      },
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('href="/docs"')
    expect(html).toContain('site-nav-children')
    expect(html).toContain('href="/docs/api"')
    expect(html).toContain('href="https://github.com/example/repo"')
    expect(html).not.toContain('>Blog</a>')
  })

  it('falls back to the generated nav without a header menu', async () => {
    const { app, env, executionCtx } = testSetup({ postTypes: [testPostType] })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('>Blog</a>')
    expect(html).not.toContain('site-nav-children')
  })
})

describe('feed.xml', () => {
  it('marks feeds noindex via X-Robots-Tag', async () => {
    const { app, env, executionCtx } = testSetup({ postType: testPostType })
    const response = await app.request('/blog/feed.xml', undefined, env, executionCtx)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
    expect(response.headers.get('content-type')).toContain('application/atom+xml')
  })
})

describe('site extras', () => {
  it('emits the favicon link when faviconMediaId is set', async () => {
    const { app, env, executionCtx } = testSetup({ faviconMediaId: 5 })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<link rel="icon" href="/media/5.png"/>')
  })

  it('emits the google-site-verification meta tag', async () => {
    const { app, env, executionCtx } = testSetup({ googleSiteVerification: 'abc123token' })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta name="google-site-verification" content="abc123token"/>')
  })

  it('injects headHtml before </head> and bodyEndHtml before </body>', async () => {
    const { app, env, executionCtx } = testSetup({
      headHtml: '<meta name="x-head-check" content="1"/>',
      bodyEndHtml: '<div id="foot-inject"></div>',
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta name="x-head-check" content="1"/></head>')
    expect(html).toContain('<div id="foot-inject"></div></body>')
  })

  it('emits no extras when nothing is configured', async () => {
    const { app, env, executionCtx } = testSetup()
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).not.toContain('rel="icon"')
    expect(html).not.toContain('google-site-verification')
  })
})

describe('robots.txt', () => {
  it('appends robotsExtra between the default rules and the Sitemap line', async () => {
    const { app, env, executionCtx } = testSetup({
      robotsExtra: 'Disallow: /private/\n\n\nDisallow: /tmp/\n',
    })
    const response = await app.request('/robots.txt', undefined, env, executionCtx)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toBe(
      [
        'User-agent: *',
        'Disallow: /admin',
        'Disallow: /api',
        'Disallow: /preview',
        '',
        'Disallow: /private/',
        '',
        'Disallow: /tmp/',
        '',
        'Sitemap: https://example.com/sitemap.xml',
      ].join('\n'),
    )
  })
})

describe('custom 404', () => {
  const notFoundPage = {
    ...testPage,
    id: 7,
    title: 'Oops, nothing here',
    bodyHtml: '<p>Sorry, that page is gone.</p>',
  }

  it('renders the configured published page body with a 404 status', async () => {
    const { app, env, executionCtx } = testSetup({
      notFoundPageId: 7,
      custom404: notFoundPage,
    })
    const response = await app.request('/missing-path', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(404)
    expect(html).toContain('Oops, nothing here')
    expect(html).toContain('Sorry, that page is gone.')
    expect(html).toContain('noindex')
  })

  it('falls back to the standard 404 when unset', async () => {
    const { app, env, executionCtx } = testSetup()
    const response = await app.request('/missing-path', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(404)
    expect(html).toContain('<h1>404</h1>')
  })

  it('falls back to the standard 404 when the configured page is not public', async () => {
    const { app, env, executionCtx } = testSetup({ notFoundPageId: 7, custom404: undefined })
    const response = await app.request('/missing-path', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(404)
    expect(html).toContain('<h1>404</h1>')
    expect(html).not.toContain('Sorry, that page is gone.')
  })
})

describe('maintenance mode', () => {
  it('returns a themed 503 page for anonymous GETs', async () => {
    const { app, env, executionCtx } = testSetup({
      maintenance: true,
      maintenanceMessage: 'Back at noon.',
    })
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBeNull()
    expect(html).toContain('Back at noon.')
    expect(html).toContain('noindex')
  })

  it('lets signed-in staff browse normally', async () => {
    const { app, env, executionCtx } = testSetup({
      maintenance: true,
      sessionUser: { id: 7, name: 'Editor' },
    })
    const response = await app.request(
      '/contact',
      { headers: { cookie: 'kanso_session=test-token' } },
      env,
      executionCtx,
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('Write to us.')
  })

  it('keeps robots.txt and sitemap.xml reachable', async () => {
    const { app, env, executionCtx } = testSetup({ maintenance: true })
    const robots = await app.request('/robots.txt', undefined, env, executionCtx)
    const sitemap = await app.request('/sitemap.xml', undefined, env, executionCtx)

    expect(robots.status).toBe(200)
    expect(sitemap.status).toBe(200)
  })

  it('does not block non-GET requests', async () => {
    const { app, env, executionCtx } = testSetup({ maintenance: true })
    const response = await app.request(
      '/forms/contact-form/submissions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Taro' }),
      },
      env,
      executionCtx,
    )

    expect(response.status).not.toBe(503)
  })
})

describe('pageview analytics', () => {
  async function flush() {
    // Let the waitUntil'd async work (settings.site() → recordView) settle.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('records a view for a 200 HTML GET', async () => {
    const { app, env, executionCtx, kanso } = testSetup()
    const response = await app.request('/contact', undefined, env, executionCtx)
    await flush()

    expect(response.status).toBe(200)
    expect(kanso.analytics.recordView).toHaveBeenCalledWith('/contact', 'UTC')
  })

  it('skips excluded paths, non-200 responses and bot user agents', async () => {
    const { app, env, executionCtx, kanso } = testSetup()
    await app.request('/search?q=hello', undefined, env, executionCtx)
    await app.request('/missing-path', undefined, env, executionCtx)
    await app.request(
      '/contact',
      { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } },
      env,
      executionCtx,
    )
    await flush()

    expect(kanso.analytics.recordView).not.toHaveBeenCalled()
  })
})

describe('draft share preview', () => {
  it('renders a shared draft page without a session', async () => {
    const { app, env, executionCtx } = testSetup({
      shareTarget: { targetType: 'page', targetId: 1 },
    })
    const response = await app.request('/preview/share/raw-token', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(html).toContain('noindex')
    expect(html).toContain('nofollow')
    expect(html).toContain('Write to us.')
  })

  it('returns 404 for an unknown or expired token', async () => {
    const { app, env, executionCtx } = testSetup()
    const response = await app.request('/preview/share/gone', undefined, env, executionCtx)

    expect(response.status).toBe(404)
  })
})

describe('custom post fields', () => {
  const fieldDefs: SectionField[] = [
    { type: 'text', name: 'venue', label: '会場', maxLength: 200 },
    { type: 'url', name: 'ticket', label: 'チケット' },
    { type: 'checkbox', name: 'online', label: 'オンライン', default: false },
    { type: 'image', name: 'map', label: '地図' },
  ]

  it('renders defined values as a dl under the post body', async () => {
    const { app, env, executionCtx } = testSetup({
      postType: { ...testPostType, fieldsJson: fieldDefs },
      post: {
        ...testPost,
        fieldsJson: {
          venue: 'Hall A',
          ticket: 'https://tickets.example.com',
          online: true,
          map: 42,
        },
      },
    })
    const response = await app.request('/blog/hello', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<dl class="post-fields">')
    expect(html).toContain('<dt>会場</dt>')
    expect(html).toContain('<dd>Hall A</dd>')
    expect(html).toContain('<dt>オンライン</dt>')
    expect(html).toContain('<a href="https://tickets.example.com">https://tickets.example.com</a>')
    // `image` fields resolve media ids to URLs.
    expect(html).toContain('src="/media/42.png"')
  })

  it('skips empty values and renders nothing when values are unset', async () => {
    const { app, env, executionCtx } = testSetup({
      postType: { ...testPostType, fieldsJson: fieldDefs },
      post: { ...testPost, fieldsJson: null },
    })
    const response = await app.request('/blog/hello', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).not.toContain('post-fields')
  })

  it('renders posts-type fields as a list of published post links', async () => {
    const { app, env, executionCtx, kanso } = testSetup({
      postType: {
        ...testPostType,
        fieldsJson: [{ type: 'posts', name: 'related', label: '関連記事' }],
      },
      post: {
        ...testPost,
        fieldsJson: { related: { postTypeSlug: 'blog', limit: 5 } },
      },
    })
    // The field resolves via postTypes.findBySlug + posts.listPublished.
    vi.mocked(kanso.posts.listPublished).mockResolvedValue({
      items: [{ id: 10, title: 'Related post', slug: 'related-post' }],
      total: 1,
    } as never)
    const response = await app.request('/blog/hello', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<dt>関連記事</dt>')
    expect(html).toContain('<a href="/blog/related-post">Related post</a>')
  })
})

describe('author archive and article extras (T56)', () => {
  const author = {
    id: 4,
    name: 'Taro',
    slug: 'taro',
    bio: 'Writes about kansoCMS.',
    avatar: { url: '/media/avatar.png', alt: 'Taro' },
  }

  it('links the byline author name to the author archive', async () => {
    const { app, env, executionCtx } = testSetup({
      postType: testPostType,
      post: { ...testPost, authorName: 'Taro', authorSlug: 'taro' },
    })
    const response = await app.request('/blog/hello', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<a class="post-author" href="/blog/author/taro">Taro</a>')
  })

  it('renders the author archive with bio, avatar and posts', async () => {
    const { app, env, executionCtx, kanso } = testSetup({ postType: testPostType, author })
    vi.mocked(kanso.posts.listPublished).mockResolvedValue({
      items: [{ id: 9, title: 'Hello world', slug: 'hello', publishedAt: new Date(), excerpt: '' }],
      total: 1,
    } as never)
    const response = await app.request('/blog/author/taro', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(kanso.posts.listPublished).toHaveBeenCalledWith(
      expect.objectContaining({ postTypeId: testPostType.id, authorId: author.id }),
    )
    expect(html).toContain('Taro – Blog')
    expect(html).toContain('Writes about kansoCMS.')
    expect(html).toContain('author-avatar')
    expect(html).toContain('<a href="/blog/hello">Hello world</a>')
  })

  it('returns 404 for an unknown author slug', async () => {
    const { app, env, executionCtx } = testSetup({ postType: testPostType, author: null })
    const response = await app.request('/blog/author/nobody', undefined, env, executionCtx)
    expect(response.status).toBe(404)
  })

  it('adds heading ids and renders a table of contents for 2+ headings', async () => {
    const bodyJson: RichTextDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    }
    const { app, env, executionCtx } = testSetup({
      postType: testPostType,
      post: {
        ...testPost,
        bodyJson,
        bodyHtml: '<h2>First</h2><p>Body.</p><h3>Second</h3>',
      },
    })
    const response = await app.request('/blog/hello', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('class="toc"')
    expect(html).toContain('href="#h-1"')
    expect(html).toContain('<h2 id="h-1">First</h2>')
    expect(html).toContain('<h3 id="h-2">Second</h3>')
  })

  it('hides the table of contents when there is only one heading', async () => {
    const { app, env, executionCtx } = testSetup({
      postType: testPostType,
      post: {
        ...testPost,
        bodyJson: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Only' }] },
          ],
        },
        bodyHtml: '<h2>Only</h2>',
      },
    })
    const response = await app.request('/blog/hello', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).not.toContain('class="toc"')
    expect(html).toContain('<h2 id="h-1">Only</h2>')
  })

  it('renders related posts from the service result', async () => {
    const { app, env, executionCtx } = testSetup({
      postType: testPostType,
      post: { ...testPost, categories: [{ id: 5, slug: 'news', name: 'News' }] },
      related: {
        items: [{ ...testPost, id: 11, slug: 'cousin', title: 'Cousin post' }],
      },
    })
    const response = await app.request('/blog/hello', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('related-posts')
    expect(html).toContain('<a href="/blog/cousin">Cousin post</a>')
  })

  it('includes author archives in the sitemap', async () => {
    const { app, env, executionCtx } = testSetup({
      postType: testPostType,
      postTypes: [testPostType],
      authorArchives: [
        { postTypeId: testPostType.id, slug: 'taro', updatedAt: new Date('2026-09-20') },
      ],
    })
    const response = await app.request('/sitemap.xml', undefined, env, executionCtx)
    const xml = await response.text()

    expect(response.status).toBe(200)
    expect(xml).toContain('https://example.com/blog/author/taro')
  })
})
