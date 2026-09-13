import { describe, expect, it } from 'vitest'
import { sniffMime } from './sniff.ts'

describe('sniffMime', () => {
  it.each([
    ['JPEG', new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg'],
    ['PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['GIF87a', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), 'image/gif'],
    ['GIF89a', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'image/gif'],
    [
      'WebP',
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      'image/webp',
    ],
    [
      'AVIF',
      new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]),
      'image/avif',
    ],
    [
      'AVIS',
      new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73]),
      'image/avif',
    ],
    ['PDF', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 'application/pdf'],
  ] as const)('recognizes %s bytes', (_name, bytes, expected) => {
    expect(sniffMime(bytes)).toBe(expected)
  })

  it('returns null for input that is too short', () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50]))).toBeNull()
  })

  it('returns null for the wrong magic bytes', () => {
    expect(
      sniffMime(new Uint8Array([0x4e, 0x4f, 0x54, 0x2d, 0x49, 0x4d, 0x41, 0x47, 0x45])),
    ).toBeNull()
  })
})
