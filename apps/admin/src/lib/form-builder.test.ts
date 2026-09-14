import { describe, expect, it } from 'vitest'
import {
  changeFieldType,
  emptyDraft,
  moveField,
  newField,
  validateFormDraft,
} from './form-builder.ts'

describe('form builder', () => {
  it('creates uniquely named fields with type defaults', () => {
    const first = newField('text', [])
    const existing = [first, newField('checkbox', [first])]
    const field = newField('textarea', existing)

    expect(field).toMatchObject({ type: 'textarea', name: 'field_3', maxLength: 2000, rows: 5 })
  })

  it('changes type while preserving shared values and dropping old attributes', () => {
    const source = {
      ...newField('textarea', []),
      label: 'Message',
      required: true,
      placeholder: 'Write here',
      help: 'Be specific',
    }
    const changed = changeFieldType(source, 'select')

    expect(changed).toEqual({
      type: 'select',
      name: 'field_1',
      label: 'Message',
      required: true,
      placeholder: 'Write here',
      help: 'Be specific',
      options: [{ value: 'option_1', label: '' }],
    })
    expect(changed).not.toHaveProperty('rows')
    expect(changed).not.toHaveProperty('maxLength')
  })

  it('moves fields without mutating the source array', () => {
    const fields = [newField('text', []), newField('email', [newField('text', [])])]
    const moved = moveField(fields, 1, -1)

    expect(moved.map((field) => field.type)).toEqual(['email', 'text'])
    expect(fields.map((field) => field.type)).toEqual(['text', 'email'])
    expect(moveField(fields, 0, -1)).toBe(fields)
  })

  it('validates and normalizes a complete draft', () => {
    const draft = emptyDraft()
    draft.name = ' Contact '
    draft.slug = 'contact'
    draft.redirectUrl = '  '
    draft.notifyTo = 'one@example.com\ntwo@example.com'
    const field = draft.fields[0]
    if (!field) throw new Error('Expected an initial field')
    draft.fields[0] = { ...field, label: ' Name ' }

    expect(validateFormDraft(draft)).toEqual({
      ok: true,
      data: {
        name: 'Contact',
        slug: 'contact',
        redirectUrl: null,
        notifyTo: 'one@example.com,two@example.com',
        successMessage: '',
        turnstile: false,
        fields: [
          {
            type: 'text',
            name: 'field_1',
            label: 'Name',
            required: false,
            placeholder: null,
            help: null,
            maxLength: 200,
          },
        ],
      },
    })
  })

  it('maps validation issues to dotted paths and keeps the first issue', () => {
    const draft = emptyDraft()
    draft.fields.push({ ...newField('text', draft.fields), name: 'field_1' })
    const result = validateFormDraft(draft)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toMatchObject({
      slug: expect.any(String),
      name: expect.any(String),
      'fields.0.label': expect.any(String),
      fields: expect.any(String),
    })
  })
})
