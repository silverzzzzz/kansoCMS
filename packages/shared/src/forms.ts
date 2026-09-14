import { z } from 'zod'
import { listQuerySchema } from './query.ts'
import { slugSchema } from './slug.ts'

export const FORM_FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'] as const
export const FORM_FIELDS_MAX = 30
export const FORM_FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

const baseFieldShape = {
  name: z.string().regex(FORM_FIELD_NAME_PATTERN),
  label: z.string().trim().min(1).max(100),
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(200).nullable().default(null),
  help: z.string().trim().max(300).nullable().default(null),
}

const shortTextFieldShape = {
  ...baseFieldShape,
  maxLength: z.number().int().min(1).max(500).default(200),
}

const selectOptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(100),
})

export const formFieldSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), ...shortTextFieldShape }),
  z.object({ type: z.literal('email'), ...shortTextFieldShape }),
  z.object({ type: z.literal('tel'), ...shortTextFieldShape }),
  z.object({
    type: z.literal('textarea'),
    ...baseFieldShape,
    maxLength: z.number().int().min(1).max(10000).default(2000),
    rows: z.number().int().min(2).max(20).default(5),
  }),
  z.object({
    type: z.literal('select'),
    ...baseFieldShape,
    options: z
      .array(selectOptionSchema)
      .min(1)
      .max(50)
      .refine((options) => new Set(options.map((option) => option.value)).size === options.length, {
        message: 'Option values must be unique',
      }),
  }),
  z.object({ type: z.literal('checkbox'), ...baseFieldShape }),
])

export const formFieldListSchema = z
  .array(formFieldSchema)
  .min(1)
  .max(FORM_FIELDS_MAX)
  .refine((fields) => new Set(fields.map((field) => field.name)).size === fields.length, {
    message: 'Field names must be unique',
  })

export const notifyToSchema = z
  .string()
  .max(1000)
  .transform((value, ctx) => {
    const addresses = value
      .split(/[\s,]+/)
      .map((address) => address.trim())
      .filter(Boolean)

    if (addresses.length > 10) {
      ctx.addIssue({ code: 'custom', message: 'Use no more than 10 email addresses' })
      return z.NEVER
    }
    for (const address of addresses) {
      if (!z.email().safeParse(address).success) {
        ctx.addIssue({ code: 'custom', message: `Invalid email address: ${address}` })
      }
    }
    if (ctx.issues.length > 0) return z.NEVER
    return addresses.join(',')
  })

export function notifyToAddresses(value: string): string[] {
  return value
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
}

export const redirectUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    if (value.startsWith('/')) return !value.startsWith('//')
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, 'Use an http(s) URL or a path beginning with /')

// Defaults live only on the create schema: in zod 4, `.partial()` keeps applying
// `.default()`, which would turn every PATCH into a reset of the omitted fields.
export const formFieldsSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  fields: formFieldListSchema,
  notifyTo: notifyToSchema,
  successMessage: z.string().trim().max(1000),
  redirectUrl: redirectUrlSchema.nullable(),
  turnstile: z.boolean(),
})

export const createFormSchema = formFieldsSchema.extend({
  notifyTo: formFieldsSchema.shape.notifyTo.default(''),
  successMessage: formFieldsSchema.shape.successMessage.default(''),
  redirectUrl: formFieldsSchema.shape.redirectUrl.default(null),
  turnstile: formFieldsSchema.shape.turnstile.default(false),
})
export const updateFormSchema = formFieldsSchema.partial()

export type FormField = z.infer<typeof formFieldSchema>
export type CreateFormInput = z.infer<typeof createFormSchema>
export type UpdateFormInput = z.infer<typeof updateFormSchema>

export type SubmissionValues = Record<string, string | boolean>
export type SubmissionMeta = {
  ip: string | null
  userAgent: string | null
  referrer: string | null
  country: string | null
}

const TELEPHONE_PATTERN = /^[0-9+()\-\s]{3,40}$/
const CHECKBOX_TRUE_VALUES = new Set(['on', 'true', '1', 'yes'])

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function textValueSchema(required: boolean, maxLength: number) {
  let schema = z.string().trim().max(maxLength, `Use at most ${maxLength} characters`)
  if (required) schema = schema.min(1, 'This field is required')
  return z.preprocess(stringInput, schema)
}

function emailValueSchema(required: boolean, maxLength: number) {
  let schema = z.string().trim().max(maxLength, `Use at most ${maxLength} characters`)
  if (required) schema = schema.min(1, 'This field is required')
  return z.preprocess(
    stringInput,
    schema.refine((value) => value === '' || z.email().safeParse(value).success, {
      message: 'Invalid email address',
    }),
  )
}

function telephoneValueSchema(required: boolean, maxLength: number) {
  let schema = z.string().trim().max(maxLength, `Use at most ${maxLength} characters`)
  if (required) schema = schema.min(1, 'This field is required')
  return z.preprocess(
    stringInput,
    schema.refine((value) => value === '' || TELEPHONE_PATTERN.test(value), {
      message: 'Invalid telephone number',
    }),
  )
}

function selectValueSchema(field: Extract<FormField, { type: 'select' }>) {
  const allowed = new Set(field.options.map((option) => option.value))
  return z.preprocess(
    stringInput,
    z.string().refine((value) => allowed.has(value) || (!field.required && value === ''), {
      message: 'Select a valid option',
    }),
  )
}

function checkboxValueSchema(required: boolean) {
  return z
    .preprocess(
      (value) =>
        value === true ||
        (typeof value === 'string' && CHECKBOX_TRUE_VALUES.has(value.toLowerCase())),
      z.boolean(),
    )
    .refine((value) => !required || value, { message: 'This field is required' })
}

export function submissionSchemaFor(
  fields: FormField[],
): z.ZodType<SubmissionValues, Record<string, unknown>> {
  const shape: Record<string, z.ZodType<string | boolean, unknown>> = {}
  for (const field of fields) {
    switch (field.type) {
      case 'text':
      case 'textarea':
        shape[field.name] = textValueSchema(field.required, field.maxLength)
        break
      case 'email':
        shape[field.name] = emailValueSchema(field.required, field.maxLength)
        break
      case 'tel':
        shape[field.name] = telephoneValueSchema(field.required, field.maxLength)
        break
      case 'select':
        shape[field.name] = selectValueSchema(field)
        break
      case 'checkbox':
        shape[field.name] = checkboxValueSchema(field.required)
        break
    }
  }
  return z.object(shape)
}

export const submissionListQuerySchema = listQuerySchema
  .pick({ page: true, perPage: true })
  .extend({ unread: z.enum(['true', 'false']).optional() })
