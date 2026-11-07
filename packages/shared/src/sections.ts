import { z } from 'zod'
import { FORM_FIELD_NAME_PATTERN, redirectUrlSchema } from './forms.ts'
import { slugSchema } from './slug.ts'

export const SECTION_FIELD_TYPES = [
  'text',
  'textarea',
  'url',
  'select',
  'checkbox',
  'number',
  'color',
  'image',
  'posts',
] as const
export const SECTION_FIELDS_MAX = 30
export const SECTIONS_MAX = 30

const baseFieldShape = {
  name: z.string().regex(FORM_FIELD_NAME_PATTERN),
  label: z.string().trim().min(1).max(100),
  help: z.string().trim().max(300).optional(),
}

const urlValueSchema = z.union([z.literal(''), redirectUrlSchema])
/** Empty string means "use the theme default". */
const colorValueSchema = z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)])
const imageValueSchema = z.number().int().positive().nullable()
const postsValueSchema = z.object({
  postTypeSlug: slugSchema.nullable().default(null),
  limit: z.number().int().min(1).max(20).default(5),
})

type NumberConstraints = { min?: number; max?: number; step?: number }

function numberValueSchema(field: NumberConstraints) {
  let schema = z.number()
  if (field.min !== undefined) schema = schema.min(field.min)
  if (field.max !== undefined) schema = schema.max(field.max)
  const step = field.step
  return schema.refine(
    (value) => {
      if (step === undefined) return true
      const steps = (value - (field.min ?? 0)) / step
      return Math.abs(steps - Math.round(steps)) <= 1e-8
    },
    { message: 'Use a value aligned with the field step' },
  )
}

function emptyNumber(field: NumberConstraints): number {
  if (field.min !== undefined) return field.min
  const value = Math.min(0, field.max ?? 0)
  return field.step === undefined ? value : Math.floor(value / field.step) * field.step
}

export const sectionFieldSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      ...baseFieldShape,
      maxLength: z.number().int().min(1).max(500).default(200),
      default: z.string().optional(),
    })
    .refine((field) => field.default === undefined || field.default.length <= field.maxLength, {
      path: ['default'],
      message: 'Default exceeds maxLength',
    }),
  z
    .object({
      type: z.literal('textarea'),
      ...baseFieldShape,
      maxLength: z.number().int().min(1).max(10000).default(2000),
      default: z.string().optional(),
    })
    .refine((field) => field.default === undefined || field.default.length <= field.maxLength, {
      path: ['default'],
      message: 'Default exceeds maxLength',
    }),
  z.object({ type: z.literal('url'), ...baseFieldShape, default: urlValueSchema.optional() }),
  z
    .object({
      type: z.literal('select'),
      ...baseFieldShape,
      options: z
        .array(
          z.object({
            value: z.string().trim().min(1).max(100),
            label: z.string().trim().min(1).max(100),
          }),
        )
        .min(1)
        .max(50)
        .refine(
          (options) => new Set(options.map((option) => option.value)).size === options.length,
          {
            message: 'Option values must be unique',
          },
        ),
      default: z.string().optional(),
    })
    .refine(
      (field) =>
        field.default === undefined ||
        field.default === '' ||
        field.options.some((option) => option.value === field.default),
      { path: ['default'], message: 'Default must be a valid option or empty' },
    ),
  z.object({ type: z.literal('checkbox'), ...baseFieldShape, default: z.boolean().default(false) }),
  z
    .object({
      type: z.literal('number'),
      ...baseFieldShape,
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().positive().optional(),
      default: z.number().optional(),
    })
    .superRefine((field, ctx) => {
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        ctx.addIssue({ code: 'custom', path: ['max'], message: 'Max must be at least min' })
      }
      if (
        field.default !== undefined &&
        !numberValueSchema(field).safeParse(field.default).success
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['default'],
          message: 'Default must satisfy constraints',
        })
      }
      if (
        field.default === undefined &&
        !numberValueSchema(field).safeParse(emptyNumber(field)).success
      ) {
        ctx.addIssue({ code: 'custom', message: 'Constraints must allow a finite empty value' })
      }
    }),
  z.object({ type: z.literal('color'), ...baseFieldShape, default: colorValueSchema.optional() }),
  z.object({ type: z.literal('image'), ...baseFieldShape, default: imageValueSchema.optional() }),
  z.object({ type: z.literal('posts'), ...baseFieldShape, default: postsValueSchema.optional() }),
])

export const sectionFieldListSchema = z
  .array(sectionFieldSchema)
  .max(SECTION_FIELDS_MAX)
  .refine((fields) => new Set(fields.map((field) => field.name)).size === fields.length, {
    message: 'Field names must be unique',
  })

export type SectionField = z.infer<typeof sectionFieldSchema>
export type SectionValues = Record<
  string,
  string | boolean | number | null | z.infer<typeof postsValueSchema>
>

export function sectionValuesSchemaFor(
  fields: SectionField[],
): z.ZodType<SectionValues, Record<string, unknown>> {
  const shape: Record<string, z.ZodType<SectionValues[string], unknown>> = {}
  for (const field of fields) {
    switch (field.type) {
      case 'text':
      case 'textarea':
        shape[field.name] = z
          .string()
          .max(field.maxLength)
          .default(field.default ?? '')
        break
      case 'url':
        shape[field.name] = urlValueSchema.default(field.default ?? '')
        break
      case 'select': {
        const allowed = new Set(field.options.map((option) => option.value))
        shape[field.name] = z
          .string()
          .refine((value) => value === '' || allowed.has(value), 'Select a valid option')
          .default(field.default ?? '')
        break
      }
      case 'checkbox':
        shape[field.name] = z.boolean().default(field.default)
        break
      case 'number':
        shape[field.name] = numberValueSchema(field).default(field.default ?? emptyNumber(field))
        break
      case 'color':
        shape[field.name] = colorValueSchema.default(field.default ?? '')
        break
      case 'image':
        shape[field.name] = imageValueSchema.default(field.default ?? null)
        break
      case 'posts':
        shape[field.name] = postsValueSchema.default(
          field.default ?? { postTypeSlug: null, limit: 5 },
        )
        break
    }
  }
  return z.object(shape)
}

export const pageSectionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/),
  type: z.string().regex(FORM_FIELD_NAME_PATTERN),
  settings: z.record(z.string(), z.unknown()),
})

export const pageSectionsSchema = z
  .array(pageSectionSchema)
  .max(SECTIONS_MAX)
  .refine((sections) => new Set(sections.map((section) => section.id)).size === sections.length, {
    message: 'Section IDs must be unique',
  })

export type PageSection = z.infer<typeof pageSectionSchema>

/** Without a catalog, collect every top-level string in section and setting order. */
export function sectionsPlainText(sections: PageSection[]): string {
  return sections
    .flatMap((section) => Object.values(section.settings))
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
}
