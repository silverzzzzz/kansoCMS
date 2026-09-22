import { type Kanso, KansoError } from '@kanso/core'
import {
  DEFAULT_SUBMISSION_MESSAGES,
  type RichTextDoc,
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
  parentId: null,
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
  ogMediaId: null,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  updatedAt: new Date('2026-09-15T00:00:00Z'),
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
    redirect?: { to: string; status: 301 | 302 } | null
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
        logoMediaId: null,
        homePostTypeSlug: null,
        theme: options.theme,
      }),
      organization: vi.fn().mockResolvedValue({ name: '', url: null, logoUrl: null, sameAs: [] }),
      forms: vi.fn().mockResolvedValue({
        fromEmail: '',
        fromName: '',
        notifyTo: '',
        turnstileSiteKey: options.turnstileSiteKey ?? '',
      }),
    },
    pages: {
      listPublishedTopLevel: vi.fn().mockResolvedValue([]),
      findPublishedByPath: vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(path === page.path ? page : undefined),
        ),
    },
    postTypes: {
      list: vi.fn().mockResolvedValue([]),
      findBySlug: vi.fn().mockResolvedValue(undefined),
    },
    redirects: { findByPath },
    search: { search },
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
  return { app, createSubmission, findByPath, search, env, executionCtx }
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
      expect(html).toContain('name="robots" content="noindex, nofollow"')
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
