import { type Kanso, KansoError } from '@kanso/core'
import { type SubmissionValues, submissionSchemaFor } from '@kanso/shared'
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
  bodyJson: null,
  bodyHtml: '<p>Write to us.</p><div data-kanso-form="contact-form"></div>',
  excerpt: '',
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
): SubmissionValues {
  const result = submissionSchemaFor(form.fieldsJson).safeParse(raw)
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
    turnstileSiteKey?: string
    turnstileSecretKey?: string
  } = {},
) {
  const form = options.form ?? testForm
  const page = options.page ?? testPage
  const createSubmission = vi.fn().mockResolvedValue({ id: 10 })
  const kanso: Kanso = Object.assign(Object.create(null), {
    settings: {
      site: vi.fn().mockResolvedValue({
        title: 'Test site',
        description: '',
        locale: 'en',
        timezone: 'UTC',
        logoMediaId: null,
        homePostTypeSlug: null,
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
  return { app, createSubmission, env, executionCtx }
}

describe('site form routes', () => {
  it('renders an embedded form on a published page without a Turnstile script', async () => {
    const { app, env, executionCtx } = testSetup()
    const response = await app.request('/contact', undefined, env, executionCtx)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<form method="post" action="/contact"')
    expect(html).not.toContain('challenges.cloudflare.com/turnstile/v0/api.js')
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
