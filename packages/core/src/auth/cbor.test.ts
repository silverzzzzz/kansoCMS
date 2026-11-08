import { describe, expect, it } from 'vitest'
import { CborError, decodeCbor, decodeCborPrefix } from './cbor.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)

describe('decodeCbor', () => {
  it('decodes the types WebAuthn uses', () => {
    // {1: 2, 3: -7, -1: 1, "fmt": "none", "k": h'0102', "a": [true, false, null]}
    const decoded = decodeCbor(
      bytes(
        0xa6,
        0x01,
        0x02,
        0x03,
        0x26,
        0x20,
        0x01,
        0x63,
        0x66,
        0x6d,
        0x74,
        0x64,
        0x6e,
        0x6f,
        0x6e,
        0x65,
        0x61,
        0x6b,
        0x42,
        0x01,
        0x02,
        0x61,
        0x61,
        0x83,
        0xf5,
        0xf4,
        0xf6,
      ),
    )
    expect(decoded).toEqual(
      new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        ['fmt', 'none'],
        ['k', bytes(1, 2)],
        ['a', [true, false, null]],
      ]),
    )
  })

  it('decodes multi-byte lengths and integers', () => {
    expect(decodeCbor(bytes(0x19, 0x01, 0x00))).toBe(256)
    expect(decodeCbor(bytes(0x39, 0x01, 0x00))).toBe(-257)
    expect(decodeCbor(bytes(0x1a, 0x00, 0x01, 0x00, 0x00))).toBe(65536)
    const long = decodeCbor(Uint8Array.from([0x58, 40, ...new Array(40).fill(7)]))
    expect(long).toBeInstanceOf(Uint8Array)
    expect((long as Uint8Array).length).toBe(40)
  })

  it('reports where a prefix item ends', () => {
    expect(decodeCborPrefix(bytes(0x01, 0x02), 0)).toEqual({ value: 1, end: 1 })
  })

  it.each([
    ['truncated input', bytes(0x42, 0x01)],
    ['trailing bytes', bytes(0x01, 0x02)],
    ['indefinite length', bytes(0x5f, 0x41, 0x01, 0xff)],
    ['tags', bytes(0xc1, 0x01)],
    ['floats', bytes(0xf9, 0x3c, 0x00)],
    ['duplicate keys', bytes(0xa2, 0x01, 0x01, 0x01, 0x02)],
    ['non-scalar keys', bytes(0xa1, 0x80, 0x01)],
    ['invalid UTF-8', bytes(0x61, 0xff)],
    ['a length beyond the input', bytes(0x5a, 0xff, 0xff, 0xff, 0xff)],
  ])('rejects %s', (_label, input) => {
    expect(() => decodeCbor(input)).toThrow()
  })

  it('rejects deep nesting', () => {
    const nested = new Uint8Array(40).fill(0x81)
    expect(() => decodeCbor(Uint8Array.from([...nested, 0x01]))).toThrow(CborError)
  })
})
