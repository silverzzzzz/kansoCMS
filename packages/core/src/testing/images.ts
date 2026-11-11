/**
 * Smallest byte sequences the upload checks accept as images of a given
 * size: enough header for format sniffing and for reading the dimensions.
 * (They are not decodable pictures — nothing on the server decodes pixels.)
 */

function hex(text: string): number[] {
  return (text.match(/[0-9a-f]{2}/gi) ?? []).map((byte) => Number.parseInt(byte, 16))
}

function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff]
}

function be32(value: number): number[] {
  return [...be16(value >>> 16), ...be16(value & 0xffff)]
}

function le24(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]
}

function buffer(bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

export function pngBytes(width: number, height: number): ArrayBuffer {
  const signature = hex('89 50 4e 47 0d 0a 1a 0a')
  const header = hex('00 00 00 0d 49 48 44 52') // IHDR, 13 bytes
  return buffer([
    ...signature,
    ...header,
    ...be32(width),
    ...be32(height),
    ...hex('08 06 00 00 00'),
  ])
}

/** WebP with an extended header (VP8X), which carries the canvas size. */
export function webpBytes(width: number, height: number): ArrayBuffer {
  const riff = hex('52 49 46 46 16 00 00 00 57 45 42 50') // RIFF … WEBP
  const vp8x = hex('56 50 38 58 0a 00 00 00 00 00 00 00')
  return buffer([...riff, ...vp8x, ...le24(width - 1), ...le24(height - 1)])
}

/** Baseline JPEG header, optionally with an EXIF orientation tag. */
export function jpegBytes(width: number, height: number, orientation?: number): ArrayBuffer {
  const exif =
    orientation === undefined
      ? []
      : [
          ...hex('ff e1 00 22'), // APP1, 34 bytes
          ...hex('45 78 69 66 00 00'), // "Exif\0\0"
          ...hex('4d 4d 00 2a 00 00 00 08'), // big-endian TIFF, directory at 8
          ...hex('00 01'), // one entry:
          ...hex('01 12 00 03 00 00 00 01'), // Orientation, SHORT, count 1
          ...be16(orientation),
          ...hex('00 00 00 00 00 00'), // padding, no next directory
        ]
  const frame = [...hex('ff c0 00 11 08'), ...be16(height), ...be16(width)] // SOF0
  return buffer([...hex('ff d8'), ...exif, ...frame, ...hex('03 01 11 00 02 11 01 03 11 01')])
}
