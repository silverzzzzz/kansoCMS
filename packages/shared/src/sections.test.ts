import { describe, expect, it } from 'vitest'
import {
  pageSectionsSchema,
  SECTIONS_MAX,
  sectionFieldListSchema,
  sectionFieldSchema,
  sectionsPlainText,
  sectionValuesSchemaFor,
} from './sections.ts'

describe('sectionFieldSchema', () => {
  it('parses each field type with defaults applied', () => {
    expect(sectionFieldSchema.parse({ type: 'text', name: 'heading', label: 'Heading' })).toEqual({
      type: 'text',
      name: 'heading',
      label: 'Heading',
      maxLength: 200,
    })
    expect(
      sectionFieldSchema.parse({ type: 'checkbox', name: 'visible', label: 'Visible' }),
    ).toEqual({ type: 'checkbox', name: 'visible', label: 'Visible', default: false })
  })

  it('rejects invalid names, defaults out of range and duplicate names', () => {
    expect(
      sectionFieldSchema.safeParse({ type: 'text', name: 'Bad-Name', label: 'X' }).success,
    ).toBe(false)
    expect(
      sectionFieldSchema.safeParse({
        type: 'text',
        name: 'heading',
        label: 'X',
        maxLength: 3,
        default: 'too long',
      }).success,
    ).toBe(false)
    expect(
      sectionFieldSchema.safeParse({
        type: 'select',
        name: 'align',
        label: 'Align',
        options: [{ value: 'left', label: 'Left' }],
        default: 'right',
      }).success,
    ).toBe(false)
    expect(
      sectionFieldListSchema.safeParse([
        { type: 'text', name: 'a', label: 'A' },
        { type: 'checkbox', name: 'a', label: 'A again' },
      ]).success,
    ).toBe(false)
  })
})

describe('sectionValuesSchemaFor', () => {
  const fields = sectionFieldListSchema.parse([
    { type: 'text', name: 'heading', label: 'Heading', default: 'Hello' },
    { type: 'textarea', name: 'body', label: 'Body' },
    { type: 'url', name: 'link', label: 'Link' },
    {
      type: 'select',
      name: 'align',
      label: 'Align',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
      default: 'left',
    },
    { type: 'checkbox', name: 'visible', label: 'Visible', default: true },
    { type: 'number', name: 'columns', label: 'Columns', min: 1, max: 4, step: 1, default: 2 },
    { type: 'image', name: 'cover', label: 'Cover' },
    { type: 'posts', name: 'source', label: 'Posts' },
  ])
  const schema = sectionValuesSchemaFor(fields)

  it('fills missing values with field defaults or empty values', () => {
    expect(schema.parse({})).toEqual({
      heading: 'Hello',
      body: '',
      link: '',
      align: 'left',
      visible: true,
      columns: 2,
      cover: null,
      source: { postTypeSlug: null, limit: 5 },
    })
  })

  it('strips unknown keys and keeps provided values', () => {
    const parsed = schema.parse({
      heading: 'Custom',
      visible: false,
      cover: 12,
      source: { postTypeSlug: 'blog', limit: 3 },
      unknown: 'dropped',
    })
    expect(parsed.heading).toBe('Custom')
    expect(parsed.visible).toBe(false)
    expect(parsed.cover).toBe(12)
    expect(parsed.source).toEqual({ postTypeSlug: 'blog', limit: 3 })
    expect('unknown' in parsed).toBe(false)
  })

  it('rejects values that violate field constraints', () => {
    expect(schema.safeParse({ align: 'center' }).success).toBe(false)
    expect(schema.safeParse({ columns: 9 }).success).toBe(false)
    expect(schema.safeParse({ columns: 1.5 }).success).toBe(false)
    expect(schema.safeParse({ link: 'not a url' }).success).toBe(false)
    expect(schema.safeParse({ cover: -1 }).success).toBe(false)
    expect(schema.safeParse({ source: { postTypeSlug: 'blog', limit: 99 } }).success).toBe(false)
  })
})

describe('pageSectionsSchema', () => {
  it('accepts a section list and rejects duplicate ids or too many sections', () => {
    const section = (id: string) => ({ id, type: 'hero', settings: { heading: 'X' } })
    expect(pageSectionsSchema.parse([section('a'), section('b')])).toHaveLength(2)
    expect(pageSectionsSchema.safeParse([section('a'), section('a')]).success).toBe(false)
    expect(
      pageSectionsSchema.safeParse(
        Array.from({ length: SECTIONS_MAX + 1 }, (_, i) => section(`s${i}`)),
      ).success,
    ).toBe(false)
    expect(pageSectionsSchema.safeParse([{ ...section('a'), id: 'bad id!' }]).success).toBe(false)
  })
})

describe('sectionsPlainText', () => {
  it('joins top-level string settings in order and skips other values', () => {
    expect(
      sectionsPlainText([
        { id: 'a', type: 'hero', settings: { heading: '見出し', visible: true, cover: 3 } },
        { id: 'b', type: 'cta', settings: { body: 'Body text', source: { limit: 5 } } },
      ]),
    ).toBe('見出し\nBody text')
    expect(sectionsPlainText([])).toBe('')
  })
})
