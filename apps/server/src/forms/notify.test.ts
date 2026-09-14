import { buildSubmissionNotification, type Kanso } from '@kanso/core'
import { type FormsSettings, formFieldListSchema, type SubmissionValues } from '@kanso/shared'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { notifySubmission } from './notify.ts'
import type { PublicForm, Submission } from './submit.ts'

const formFields = formFieldListSchema.parse([
  { type: 'text', name: 'name', label: 'Name' },
  { type: 'email', name: 'email', label: 'Email' },
  { type: 'textarea', name: 'message', label: 'Message' },
  { type: 'checkbox', name: 'consent', label: 'Consent' },
])

const baseForm: PublicForm = {
  id: 7,
  slug: 'contact',
  name: 'Contact',
  fieldsJson: formFields,
  notifyTo: '',
  successMessage: 'Thanks',
  redirectUrl: null,
  turnstile: false,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  updatedAt: new Date('2026-09-15T00:00:00Z'),
}

const submissionValues: SubmissionValues = {
  name: 'Alice',
  email: 'alice@example.com',
  message: 'First line\nSecond line',
  consent: true,
}

const submission: Submission = {
  id: 42,
  formId: baseForm.id,
  dataJson: submissionValues,
  metaJson: {},
  createdAt: new Date('2026-09-15T01:00:00Z'),
  readAt: null,
}

const baseSettings: FormsSettings = {
  fromEmail: 'forms@example.com',
  fromName: '',
  notifyTo: '',
  turnstileSiteKey: '',
}

function testSetup({
  form = baseForm,
  settings = baseSettings,
  send = vi.fn().mockResolvedValue({ messageId: 'message-id' }),
}: {
  form?: PublicForm
  settings?: FormsSettings
  send?: ReturnType<typeof vi.fn>
} = {}) {
  const settingsForms = vi.fn().mockResolvedValue(settings)
  const settingsSite = vi.fn().mockResolvedValue({ title: 'Example Site' })
  const kanso: Kanso = Object.assign(Object.create(null), {
    settings: { forms: settingsForms, site: settingsSite },
  })
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .get('/', async (c) => c.json(await notifySubmission(c, form, submission)))
  const env = {
    SITE_URL: 'http://localhost:5199',
    EMAIL: { send },
  } as unknown as Bindings
  return { app, env, send, settingsForms, settingsSite }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('notifySubmission', () => {
  it('skips when fromEmail is empty', async () => {
    const { app, env, send, settingsSite } = testSetup({
      form: { ...baseForm, notifyTo: 'form@example.com' },
      settings: { ...baseSettings, fromEmail: '' },
    })

    const response = await app.request('/', undefined, env)

    await expect(response.json()).resolves.toEqual({ skipped: 'no_from' })
    expect(send).not.toHaveBeenCalled()
    expect(settingsSite).not.toHaveBeenCalled()
  })

  it('skips when the form and settings have no recipients', async () => {
    const { app, env, send, settingsSite } = testSetup()

    const response = await app.request('/', undefined, env)

    await expect(response.json()).resolves.toEqual({ skipped: 'no_recipients' })
    expect(send).not.toHaveBeenCalled()
    expect(settingsSite).not.toHaveBeenCalled()
  })

  it('uses form recipients instead of settings recipients', async () => {
    const { app, env, send } = testSetup({
      form: { ...baseForm, notifyTo: 'form@example.com' },
      settings: { ...baseSettings, notifyTo: 'settings@example.com' },
    })

    const response = await app.request('/', undefined, env)

    await expect(response.json()).resolves.toEqual({ sent: 1, failed: 0 })
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'form@example.com' }))
  })

  it('sends one complete message per recipient with the site-title sender fallback', async () => {
    const form = { ...baseForm, notifyTo: 'first@example.com,second@example.com' }
    const { app, env, send } = testSetup({ form })
    const expected = buildSubmissionNotification({
      form: { name: form.name, fields: form.fieldsJson },
      values: submissionValues,
      submissionId: submission.id,
      siteTitle: 'Example Site',
      adminUrl: 'http://localhost:5199/admin/forms/7/submissions/42',
    })

    const response = await app.request('/', undefined, env)

    await expect(response.json()).resolves.toEqual({ sent: 2, failed: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, {
      to: 'first@example.com',
      from: { email: 'forms@example.com', name: 'Example Site' },
      replyTo: 'alice@example.com',
      ...expected,
    })
    expect(send).toHaveBeenNthCalledWith(2, {
      to: 'second@example.com',
      from: { email: 'forms@example.com', name: 'Example Site' },
      replyTo: 'alice@example.com',
      ...expected,
    })
  })

  it('logs a coded send failure, continues, and resolves with counts', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'E_SENDER_NOT_VERIFIED' }))
      .mockResolvedValueOnce({ messageId: 'message-id' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { app, env } = testSetup({
      form: { ...baseForm, notifyTo: 'first@example.com,second@example.com' },
      send,
    })

    const response = await app.request('/', undefined, env)

    await expect(response.json()).resolves.toEqual({ sent: 1, failed: 1 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledOnce()
    const [logged] = consoleError.mock.calls[0] ?? []
    expect(JSON.parse(String(logged))).toEqual({
      level: 'error',
      event: 'form_notify_failed',
      formId: 7,
      submissionId: 42,
      message: 'nope',
      code: 'E_SENDER_NOT_VERIFIED',
    })
  })
})
