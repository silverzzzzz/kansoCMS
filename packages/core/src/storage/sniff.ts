import type { MediaMimeType } from '@kanso/shared'

function matches(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (offset < 0 || bytes.length < offset + expected.length) return false
  return expected.every((value, index) => bytes[offset + index] === value)
}

export function sniffMime(bytes: Uint8Array): MediaMimeType | null {
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (
    matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'image/gif'
  }
  if (matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp'
  }
  if (
    matches(bytes, 4, [0x66, 0x74, 0x79, 0x70]) &&
    (matches(bytes, 8, [0x61, 0x76, 0x69, 0x66]) || matches(bytes, 8, [0x61, 0x76, 0x69, 0x73]))
  ) {
    return 'image/avif'
  }
  if (matches(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  return null
}
