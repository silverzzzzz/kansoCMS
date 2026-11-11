import type { MediaMimeType } from '@kanso/shared'

export type ImageSize = { width: number; height: number }

function matches(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (offset < 0 || bytes.length < offset + expected.length) return false
  return expected.every((value, index) => bytes[offset + index] === value)
}

function be16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) * 0x100 + (bytes[offset + 1] ?? 0)
}

function be32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (bytes[offset + 1] ?? 0) * 0x10000 +
    (bytes[offset + 2] ?? 0) * 0x100 +
    (bytes[offset + 3] ?? 0)
  )
}

function le16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 0x100
}

function le24(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 0x100 + (bytes[offset + 2] ?? 0) * 0x10000
  )
}

function validSize(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null
}

function readPngSize(bytes: Uint8Array): ImageSize | null {
  if (
    bytes.length < 24 ||
    !matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    !matches(bytes, 12, [0x49, 0x48, 0x44, 0x52])
  ) {
    return null
  }
  return validSize(be32(bytes, 16), be32(bytes, 20))
}

function readGifSize(bytes: Uint8Array): ImageSize | null {
  if (
    bytes.length < 10 ||
    (!matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) &&
      !matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
  ) {
    return null
  }
  return validSize(le16(bytes, 6), le16(bytes, 8))
}

function le32(bytes: Uint8Array, offset: number): number {
  return le16(bytes, offset) + le16(bytes, offset + 2) * 0x10000
}

/**
 * EXIF orientation (tag 0x0112) from a JPEG APP1 segment, or null. Cameras
 * and phones store a portrait photo as landscape pixels plus this tag, and
 * browsers rotate when they draw it.
 */
function readExifOrientation(bytes: Uint8Array, start: number, length: number): number | null {
  // "Exif\0\0", then a TIFF header and its first image file directory.
  if (length < 14 || !matches(bytes, start, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00])) return null
  const tiff = start + 6
  const end = start + length
  const little = matches(bytes, tiff, [0x49, 0x49])
  if (!little && !matches(bytes, tiff, [0x4d, 0x4d])) return null
  const u16 = (offset: number) => (little ? le16(bytes, offset) : be16(bytes, offset))
  const u32 = (offset: number) => (little ? le32(bytes, offset) : be32(bytes, offset))

  const directory = tiff + u32(tiff + 4)
  if (directory + 2 > end) return null
  const entries = u16(directory)
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12
    if (entry + 12 > end) return null
    if (u16(entry) === 0x0112) return u16(entry + 8)
  }
  return null
}

/**
 * The size a JPEG is displayed at: orientations 5-8 turn the picture by a
 * quarter, so width and height swap.
 */
function readJpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || !matches(bytes, 0, [0xff, 0xd8])) return null

  let orientation: number | null = null
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null

    const marker = bytes[offset] ?? 0
    offset += 1
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (offset + 2 > bytes.length) return null

    const segmentLength = be16(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (marker === 0xe1 && orientation === null) {
      orientation = readExifOrientation(bytes, offset + 2, segmentLength - 2)
    }
    if (marker >= 0xc0 && marker <= 0xc2) {
      if (segmentLength < 7) return null
      const width = be16(bytes, offset + 5)
      const height = be16(bytes, offset + 3)
      return orientation !== null && orientation >= 5 && orientation <= 8
        ? validSize(height, width)
        : validSize(width, height)
    }
    offset += segmentLength
  }
  return null
}

function readWebpSize(bytes: Uint8Array): ImageSize | null {
  if (
    bytes.length < 16 ||
    !matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) ||
    !matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return null
  }

  if (matches(bytes, 12, [0x56, 0x50, 0x38, 0x58])) {
    if (bytes.length < 30) return null
    return validSize(le24(bytes, 24) + 1, le24(bytes, 27) + 1)
  }
  if (matches(bytes, 12, [0x56, 0x50, 0x38, 0x4c])) {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const width = 1 + (bytes[21] ?? 0) + (((bytes[22] ?? 0) & 0x3f) << 8)
    const height =
      1 + ((bytes[22] ?? 0) >> 6) + ((bytes[23] ?? 0) << 2) + (((bytes[24] ?? 0) & 0x0f) << 10)
    return validSize(width, height)
  }
  if (matches(bytes, 12, [0x56, 0x50, 0x38, 0x20])) {
    if (bytes.length < 30 || !matches(bytes, 23, [0x9d, 0x01, 0x2a])) return null
    return validSize(le16(bytes, 26) & 0x3fff, le16(bytes, 28) & 0x3fff)
  }
  return null
}

export function readImageSize(bytes: Uint8Array, mime: MediaMimeType): ImageSize | null {
  if (mime === 'image/png') return readPngSize(bytes)
  if (mime === 'image/gif') return readGifSize(bytes)
  if (mime === 'image/jpeg') return readJpegSize(bytes)
  if (mime === 'image/webp') return readWebpSize(bytes)
  return null
}
