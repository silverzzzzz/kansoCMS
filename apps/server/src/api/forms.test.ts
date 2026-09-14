import { type Kanso, KansoError } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { forms } from './forms.ts'

vi.mock('../forms/turnstile.ts', () => ({
  turnstileConfig: vi.fn().mockResolvedValue({ siteKey: 'site-key', secretKey: 'secret-key' }),
}))

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
      type: 'textarea' as const,
      name: 'message',
      label: 'Message',
      required: false,
      placeholder: null,
      help: null,
      maxLength: 2000,
      rows: 5,
    },
    {
      type: 'checkbox' as const,
      name: 'consent',
      label: 'Consent',
      required: false,
      placeholder: null,
      help: null,
    },
  ],
  notifyTo: '',
  successMessage: 'Thanks',
  redirectUrl: null,
  turnstile: false,
  createdAt: new Date('2026-09-15T00:00:00.000Z'),
  updatedAt: new Date('2026-09-15T00:00:00.000Z'),
}

const exportRows = [
  {
    id: 8,
    formId: 1,
    dataJson: { consent: true, message: 'Line 1, "quoted"\nLine 2', name: '=Alice' },
    metaJson: {
      ip: '203.0.113.1',
      userAgent: 'test-agent',
      referrer: null,
      country: 'JP',
    },
    createdAt: new Date('2026-09-15T01:00:00.000Z'),
    readAt: null,
  },
]

function testSetup(form: typeof testForm | null = testForm) {
  const get = vi.fn(async () => {
    if (!form) throw KansoError.notFound('Form')
    return form
  })
  const list = vi.fn().mockResolvedValue([{ ...testForm, submissionCount: 1, unreadCount: 1 }])
  const listForExport = vi.fn().mockResolvedValue(exportRows)
  const kanso: Kanso = Object.assign(Object.create(null), {
    forms: { get, list, submissions: { listForExport } },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .onError(onError)
    .route('/api/v1/forms', forms)
  return { app, get, listForExport }
}

describe('forms administration API', () => {
  it('includes Turnstile availability in the list response', async () => {
    const { app } = testSetup()
    const response = await app.request('/api/v1/forms', undefined, {} as Bindings)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      turnstileAvailable: true,
      items: [{ id: 1, submissionCount: 1, unreadCount: 1 }],
    })
  })

  it('exports BOM-prefixed CSV in field order with escaping and no metadata', async () => {
    const { app, listForExport } = testSetup()
    const response = await app.request(
      '/api/v1/forms/1/submissions/export.csv',
      undefined,
      {} as Bindings,
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    const body = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="contact-submissions.csv"',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(body).toBe(
      '\uFEFFid,createdAt,readAt,Name,Message,Consent\r\n' +
        '8,2026-09-15T01:00:00.000Z,,\'=Alice,"Line 1, ""quoted""\nLine 2",true\r\n',
    )
    expect(body).not.toContain('203.0.113.1')
    expect(body).not.toContain('test-agent')
    expect(listForExport).toHaveBeenCalledWith(1)
  })

  it('returns 404 when exporting an unknown form', async () => {
    const { app, listForExport } = testSetup(null)
    const response = await app.request(
      '/api/v1/forms/999/submissions/export.csv',
      undefined,
      {} as Bindings,
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: 'Form not found' },
    })
    expect(listForExport).not.toHaveBeenCalled()
  })
})
