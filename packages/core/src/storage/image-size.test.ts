import { describe, expect, it } from 'vitest'
import { readImageSize } from './image-size.ts'

describe('readImageSize', () => {
  it('reads a 2 by 3 PNG', () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
      2, 0, 0, 0, 3,
    ])
    expect(readImageSize(bytes, 'image/png')).toEqual({ width: 2, height: 3 })
  })

  it('reads a 4 by 5 GIF', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 4, 0, 5, 0])
    expect(readImageSize(bytes, 'image/gif')).toEqual({ width: 4, height: 5 })
  })

  it('reads a 6 by 7 baseline JPEG', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 7, 0, 6, 3, 1, 0x11, 0, 2, 0x11,
      0, 3, 0x11, 0,
    ])
    expect(readImageSize(bytes, 'image/jpeg')).toEqual({ width: 6, height: 7 })
  })

  it('reads an 8 by 9 WebP VP8X', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0,
      0, 0, 0, 0, 0, 7, 0, 0, 8, 0, 0,
    ])
    expect(readImageSize(bytes, 'image/webp')).toEqual({ width: 8, height: 9 })
  })

  it('returns null for input that is too short', () => {
    expect(readImageSize(new Uint8Array([0xff, 0xd8]), 'image/jpeg')).toBeNull()
  })

  it('returns null for the wrong magic bytes', () => {
    expect(readImageSize(new Uint8Array(30), 'image/webp')).toBeNull()
  })

  it('returns null for formats without header parsing', () => {
    expect(readImageSize(new Uint8Array([0]), 'image/avif')).toBeNull()
    expect(readImageSize(new Uint8Array([0]), 'application/pdf')).toBeNull()
  })
})
