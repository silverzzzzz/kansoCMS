import type { SectionField } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import { KansoError } from '../errors.ts'
import { parsePostFields } from './posts.ts'

const defs: SectionField[] = [
  { type: 'text', name: 'venue', label: '会場', maxLength: 200 },
  { type: 'number', name: 'capacity', label: '定員', min: 0 },
  { type: 'checkbox', name: 'online', label: 'オンライン', default: false },
  {
    type: 'select',
    name: 'track',
    label: 'トラック',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
]

describe('parsePostFields', () => {
  it('returns null when the post type defines no fields', () => {
    expect(parsePostFields(null, { venue: 'x' })).toBeNull()
    expect(parsePostFields([], { venue: 'x' })).toBeNull()
  })

  it('validates defined keys and fills defaults', () => {
    expect(parsePostFields(defs, { venue: 'Hall A', track: 'b' })).toEqual({
      venue: 'Hall A',
      track: 'b',
      online: false,
      capacity: 0,
    })
  })

  it('rejects invalid values with a validation error', () => {
    try {
      parsePostFields(defs, { track: 'c', capacity: -1 })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(KansoError)
      expect((error as KansoError).code).toBe('validation')
    }
  })

  it('preserves unknown keys not in the definition', () => {
    expect(parsePostFields(defs, { venue: 'Hall', legacy: 'keep' })).toEqual({
      venue: 'Hall',
      track: '',
      online: false,
      capacity: 0,
      legacy: 'keep',
    })
  })

  it('rejects defined keys arriving with the wrong type', () => {
    expect(() => parsePostFields(defs, { capacity: 'many' })).toThrowError(KansoError)
  })
})
