import { type Kanso, KansoError } from '@kanso/core'
import { type SubmissionValues, submissionSchemaFor } from '@kanso/shared'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { publicForms } from './public-forms.ts'

const testForm = {
  id: 1,
  slug: 'contact',
  name: 'Contact',
  fieldsJson: [
    {
      type: 'text' as const,
      name: 'name',
      label: 'Name',
      required: true,
      placeholder: null,
      help: null,
      maxLength: 200,
    },
    {
      type: 'checkbox' as const,
      name: 'terms',
      label: 'Accept terms',
      required: false,
      placeholder: null,
      help: null,
    },
  ],
  notifyTo: '',
  successMessage: 'Thanks',
  redirectUrl: '/complete',
  turnstile: false,
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

function testSetup(form: typeof testForm | null = testForm) {
  const createSubmission = vi.fn().mockResolvedValue({ id: 10 })
  const validateSubmissionMock = vi.fn(validateSubmission)
  const settingsForms = vi.fn().mockResolvedValue({
    fromEmail: '',
    fromName: '',
    notifyTo: '',
    turnstileSiteKey: '',
  })
  const kanso: Kanso = Object.assign(Object.create(null), {
    forms: {
      findBySlug: vi.fn().mockResolvedValue(form),
      validateSubmission: validateSubmissionMock,
      submissions: { create: createSubmission },
    },
    settings: { forms: settingsForms },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .onError(onError)
    .route('/api/v1/public/forms', publicForms)
  const env = { SITE_URL: 'https://example.com' } as Bindings
  return { app, createSubmission, env, settingsForms, validateSubmissionMock }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('public form submissions', () => {
  it('returns 404 for an unknown form slug', async () => {
    const { app, createSubmission, env } = testSetup(null)
    const response = await app.request(
      '/api/v1/public/forms/missing/submissions',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env,
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Form not found' },
    })
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('returns the normal success response for a filled honeypot without storing', async () => {
    const { app, createSubmission, env } = testSetup()
    const response = await app.request(
      '/api/v1/public/forms/contact/submissions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Bot', _hp: 'https://spam.example' }),
      },
      env,
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      ok: true,
      message: 'Thanks',
      redirectUrl: '/complete',
    })
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('rejects bodies over 64 KB by declared and actual size', async () => {
    const { app, createSubmission, env } = testSetup()
    const path = '/api/v1/public/forms/contact/submissions'
    const declared = await app.request(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '65537' },
        body: '{}',
      },
      env,
    )
    const actual = await app.request(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(65_536) }),
      },
      env,
    )

    expect(declared.status).toBe(400)
    expect(actual.status).toBe(400)
    await expect(declared.json()).resolves.toMatchObject({
      error: { code: 'validation', message: 'Request body too large' },
    })
    await expect(actual.json()).resolves.toMatchObject({
      error: { code: 'validation', message: 'Request body too large' },
    })
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('stops reading a streamed body without Content-Length once it exceeds the limit', async () => {
    const { app, createSubmission, env } = testSetup()
    let pulls = 0
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024))
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(chunk)
      },
    })
    const request = new Request('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      // @ts-expect-error `duplex` is required by fetch for streamed bodies but missing in lib.dom
      duplex: 'half',
    })

    const response = await app.request(request, undefined, env)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation', message: 'Request body too large' },
    })
    // 5 chunks cross 64 KB; the reader must not keep draining the stream after that.
    expect(pulls).toBeLessThanOrEqual(6)
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('returns field details for a required-field error', async () => {
    const { app, createSubmission, env } = testSetup()
    const response = await app.request(
      '/api/v1/public/forms/contact/submissions',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'validation',
        message: 'Invalid submission',
        details: [{ path: 'name', message: expect.any(String) }],
      },
    })
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('stores a URL-encoded body with request metadata and no reserved keys', async () => {
    const { app, createSubmission, env, validateSubmissionMock } = testSetup()
    const response = await app.request(
      '/api/v1/public/forms/contact/submissions',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'cf-connecting-ip': '203.0.113.20',
          'user-agent': 'test-agent',
          referer: 'https://site.example/contact',
        },
        body: 'name=Alice&terms=on&_form=contact&_return=%2Fcontact',
      },
      env,
    )

    expect(response.status).toBe(201)
    expect(validateSubmissionMock).toHaveBeenCalledWith(testForm, {
      name: 'Alice',
      terms: 'on',
    })
    expect(createSubmission).toHaveBeenCalledWith(
      1,
      { name: 'Alice', terms: true },
      {
        ip: '203.0.113.20',
        userAgent: 'test-agent',
        referrer: 'https://site.example/contact',
        country: null,
      },
    )
  })

  it('stores a JSON object with Cloudflare country metadata', async () => {
    const { app, createSubmission, env, validateSubmissionMock } = testSetup()
    const request = new Request('https://example.com/api/v1/public/forms/contact/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob', terms: false, _return: '/ignored' }),
    })
    Object.defineProperty(request, 'cf', { value: { country: 'JP' } })

    const response = await app.request(request, undefined, env)

    expect(response.status).toBe(201)
    expect(validateSubmissionMock).toHaveBeenCalledWith(testForm, {
      name: 'Bob',
      terms: false,
    })
    expect(createSubmission).toHaveBeenCalledWith(
      1,
      { name: 'Bob', terms: false },
      { ip: null, userAgent: null, referrer: null, country: 'JP' },
    )
  })

  it('ignores multipart files', async () => {
    const { app, createSubmission, env } = testSetup()
    const body = new FormData()
    body.set('name', 'Carol')
    body.set('_form', 'contact')
    body.set('attachment', new File(['ignored'], 'ignored.txt'))

    const response = await app.request(
      '/api/v1/public/forms/contact/submissions',
      { method: 'POST', body },
      env,
    )

    expect(response.status).toBe(201)
    expect(createSubmission).toHaveBeenCalledWith(
      1,
      { name: 'Carol', terms: false },
      { ip: null, userAgent: null, referrer: null, country: null },
    )
  })

  it('rejects a Turnstile-enabled form when configuration is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { app, createSubmission, env, settingsForms } = testSetup({
      ...testForm,
      turnstile: true,
    })
    const response = await app.request(
      '/api/v1/public/forms/contact/submissions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Dana', 'cf-turnstile-response': 'token' }),
      },
      env,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'validation', message: 'Turnstile is not configured' },
    })
    expect(settingsForms).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('adds CORS headers only through the public router', async () => {
    const { app, env } = testSetup()
    const response = await app.request(
      '/api/v1/public/forms/contact/submissions',
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://headless.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'Content-Type',
        },
      },
      env,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })
})
