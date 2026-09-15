import { formFieldListSchema } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import type { PublicForm } from '../forms/submit.ts'
import { en, ja } from '../i18n.ts'
import { expandForms, formSlugsIn } from './forms.tsx'

const fields = formFieldListSchema.parse([
  {
    type: 'text',
    name: 'name',
    label: 'Name',
    required: true,
    placeholder: 'Your name',
    help: 'Tell us who you are.',
    maxLength: 50,
  },
  { type: 'email', name: 'email', label: 'Email', maxLength: 100 },
  { type: 'tel', name: 'phone', label: 'Phone', maxLength: 40 },
  { type: 'textarea', name: 'message', label: 'Message', maxLength: 500, rows: 6 },
  {
    type: 'select',
    name: 'topic',
    label: 'Topic',
    options: [
      { value: 'support', label: 'Support' },
      { value: 'sales', label: 'Sales' },
    ],
  },
  { type: 'checkbox', name: 'terms', label: 'Accept terms', required: true },
])

const form: PublicForm = {
  id: 1,
  slug: 'contact',
  name: 'Contact',
  fieldsJson: fields,
  notifyTo: '',
  successMessage: 'Message received.',
  redirectUrl: null,
  turnstile: false,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  updatedAt: new Date('2026-09-15T00:00:00Z'),
}

describe('formSlugsIn', () => {
  it('returns unique slugs from exact form placeholders', () => {
    expect(
      formSlugsIn(
        '<p>Before</p><div data-kanso-form="contact"></div>' +
          '<div data-kanso-form="newsletter"></div>' +
          '<div data-kanso-form="contact"></div>',
      ),
    ).toEqual(['contact', 'newsletter'])
    expect(formSlugsIn('<div data-kanso-form="Invalid_slug"></div>')).toEqual([])
  })
})

describe('expandForms', () => {
  it('renders every field type as a non-JavaScript POST form', () => {
    const html = expandForms(
      '<div data-kanso-form="contact"></div>',
      new Map([[form.slug, form]]),
      { action: '/contact', turnstileSiteKey: null, messages: en.form },
    )

    expect(html).toContain('<form method="post" action="/contact" class="kanso-form">')
    expect(html).toContain('type="hidden" name="_form" value="contact"')
    expect(html).toContain('name="_hp" tabindex="-1" autocomplete="off"')
    expect(html).toContain('type="text" name="name"')
    expect(html).toContain('type="email" name="email"')
    expect(html).toContain('type="tel" name="phone"')
    expect(html).toContain('<textarea name="message"')
    expect(html).toContain('<select name="topic"')
    expect(html).toContain('type="checkbox" name="terms"')
    expect(html).toContain('maxlength="50"')
    expect(html).toContain('maxlength="500"')
    expect(html).toContain('required')
  })

  it('removes a placeholder for an unknown form', () => {
    expect(
      expandForms('<p>Before</p><div data-kanso-form="missing"></div><p>After</p>', new Map(), {
        action: '/contact',
        turnstileSiteKey: null,
        messages: en.form,
      }),
    ).toBe('<p>Before</p><p>After</p>')
  })

  it('renders the success message instead of a form', () => {
    const html = expandForms(
      '<div data-kanso-form="contact"></div>',
      new Map([[form.slug, form]]),
      {
        action: '/contact',
        turnstileSiteKey: null,
        state: { slug: 'contact', success: true },
        messages: en.form,
      },
    )

    expect(html).toContain('Message received.')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('<form')
  })

  it('renders field errors and preserves escaped submitted values', () => {
    const html = expandForms(
      '<div data-kanso-form="contact"></div>',
      new Map([[form.slug, form]]),
      {
        action: '/contact',
        turnstileSiteKey: null,
        messages: en.form,
        state: {
          slug: 'contact',
          values: { name: '<Alice "Admin">' },
          errors: [{ path: 'name', message: 'Check this value' }],
        },
      },
    )

    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('Check this value')
    expect(html).toContain('value="&lt;Alice &quot;Admin&quot;&gt;"')
  })

  it('renders Turnstile only when the form and site key are enabled', () => {
    const placeholder = '<div data-kanso-form="contact"></div>'
    const turnstileForm = { ...form, turnstile: true }
    const withKey = expandForms(placeholder, new Map([[form.slug, turnstileForm]]), {
      action: '/contact',
      turnstileSiteKey: 'site-key',
      messages: en.form,
    })
    const withoutKey = expandForms(placeholder, new Map([[form.slug, turnstileForm]]), {
      action: '/contact',
      turnstileSiteKey: null,
      messages: en.form,
    })
    const disabled = expandForms(placeholder, new Map([[form.slug, form]]), {
      action: '/contact',
      turnstileSiteKey: 'site-key',
      messages: en.form,
    })

    expect(withKey).toContain('class="cf-turnstile" data-sitekey="site-key"')
    expect(withoutKey).not.toContain('cf-turnstile')
    expect(disabled).not.toContain('cf-turnstile')
  })

  it('renders the Japanese submit label', () => {
    const html = expandForms(
      '<div data-kanso-form="contact"></div>',
      new Map([[form.slug, form]]),
      { action: '/contact', turnstileSiteKey: null, messages: ja.form },
    )

    expect(html).toContain('<button type="submit">送信</button>')
  })
})
