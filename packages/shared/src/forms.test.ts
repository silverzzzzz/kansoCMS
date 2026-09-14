import { describe, expect, it } from 'vitest'
import {
  createFormSchema,
  type FormField,
  formFieldListSchema,
  formFieldSchema,
  notifyToAddresses,
  notifyToSchema,
  redirectUrlSchema,
  submissionSchemaFor,
  updateFormSchema,
} from './forms.ts'

const fields: FormField[] = formFieldListSchema.parse([
  { type: 'text', name: 'name', label: 'Name', required: true, maxLength: 10 },
  { type: 'email', name: 'email', label: 'Email' },
  {
    type: 'select',
    name: 'topic',
    label: 'Topic',
    options: [
      { value: 'support', label: 'Support' },
      { value: 'sales', label: 'Sales' },
    ],
  },
  { type: 'checkbox', name: 'consent', label: 'I agree', required: true },
  { type: 'textarea', name: 'message', label: 'Message', maxLength: 20 },
])

describe('form field schemas', () => {
  it('rejects an unknown field type', () => {
    expect(formFieldSchema.safeParse({ type: 'number', name: 'age', label: 'Age' }).success).toBe(
      false,
    )
  })

  it('rejects duplicate field names and duplicate select values', () => {
    expect(
      formFieldListSchema.safeParse([
        { type: 'text', name: 'same', label: 'First' },
        { type: 'email', name: 'same', label: 'Second' },
      ]).success,
    ).toBe(false)
    expect(
      formFieldSchema.safeParse({
        type: 'select',
        name: 'topic',
        label: 'Topic',
        options: [
          { value: 'same', label: 'First' },
          { value: 'same', label: 'Second' },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('createFormSchema / updateFormSchema', () => {
  it('fills defaults on create only', () => {
    const created = createFormSchema.parse({ slug: 'contact', name: 'Contact', fields })
    expect(created).toMatchObject({
      notifyTo: '',
      successMessage: '',
      redirectUrl: null,
      turnstile: false,
    })
    // A PATCH with only `name` must not reset the other columns.
    expect(updateFormSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
  })
})

describe('notifyToSchema', () => {
  it('normalizes comma and whitespace separated addresses', () => {
    expect(notifyToSchema.parse(' one@example.com,\n two@example.com  three@example.com ')).toBe(
      'one@example.com,two@example.com,three@example.com',
    )
  })

  it('rejects invalid addresses and more than ten recipients', () => {
    expect(notifyToSchema.safeParse('valid@example.com invalid').success).toBe(false)
    expect(
      notifyToSchema.safeParse(
        Array.from({ length: 11 }, (_, index) => `user${index}@example.com`).join(','),
      ).success,
    ).toBe(false)
  })

  it('splits a normalized recipient string and drops blanks', () => {
    expect(notifyToAddresses(' one@example.com, ,two@example.com,')).toEqual([
      'one@example.com',
      'two@example.com',
    ])
  })
})

describe('redirectUrlSchema', () => {
  it.each(['/thanks', '/nested/thanks?sent=1', 'https://example.com/thanks', 'http://example.com'])(
    'accepts %s',
    (value) => expect(redirectUrlSchema.safeParse(value).success).toBe(true),
  )

  it.each(['//example.com', 'javascript:alert(1)', 'thanks', 'ftp://example.com'])(
    'rejects %s',
    (value) => expect(redirectUrlSchema.safeParse(value).success).toBe(false),
  )
})

describe('submissionSchemaFor', () => {
  const schema = submissionSchemaFor(fields)

  it('converts valid values and strips unknown keys', () => {
    expect(
      schema.parse({
        name: '  Alice  ',
        email: '',
        topic: 'support',
        consent: 'on',
        message: 42,
        unknown: 'discarded',
      }),
    ).toEqual({ name: 'Alice', email: '', topic: 'support', consent: true, message: '' })
  })

  it('treats omitted optional strings and an unchecked optional checkbox as empty values', () => {
    const optionalCheckbox = formFieldListSchema.parse([
      { type: 'text', name: 'nickname', label: 'Nickname' },
      { type: 'checkbox', name: 'updates', label: 'Send updates' },
    ])
    expect(submissionSchemaFor(optionalCheckbox).parse({})).toEqual({
      nickname: '',
      updates: false,
    })
  })

  it('reports required field errors at the field name', () => {
    const result = schema.safeParse({ topic: '', consent: 'no' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['name', 'consent']),
      )
      expect(result.error.issues.find((issue) => issue.path[0] === 'name')?.message).toBe(
        'This field is required',
      )
    }
  })

  it('rejects invalid email, select and overlong values', () => {
    const result = schema.safeParse({
      name: 'A name that is too long',
      email: 'not-an-email',
      topic: 'unknown',
      consent: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.find((issue) => issue.path[0] === 'name')?.message).toBe(
        'Use at most 10 characters',
      )
    }
  })

  it.each([true, 'on', 'true', '1', 'yes', 'YES'])(
    'converts checkbox truthy value %s',
    (consent) => {
      expect(schema.parse({ name: 'Alice', email: '', topic: '', consent }).consent).toBe(true)
    },
  )
})
