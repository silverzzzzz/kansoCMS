import { posix } from 'node:path'
import { gunzipSync } from 'node:zlib'

/** Reject unsafe paths before stripping or normalizing them.
 * @param {string} path */
export function safePath(path) {
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':') ||
    path.split('/').includes('..')
  )
    throw new Error(`Unsafe template path: ${path}`)
  return posix.normalize(path).replace(/\/$/, '')
}

/** @param {string} path */
export function isTaskBoard(path) {
  return path === 'docs/tasks' || path.startsWith('docs/tasks/')
}

/** Read plain ustar entries, skipping extension records and links.
 * @param {Buffer} compressed
 * @returns {Map<string, Buffer | null>} null denotes a directory. */
export function readTarGz(compressed) {
  const tar = gunzipSync(compressed)
  /** @type {Map<string, Buffer | null>} */
  const entries = new Map()
  let offset = 0
  while (offset < tar.length) {
    if (offset + 512 > tar.length) throw new Error('Truncated tar header.')
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    /** @param {number} start @param {number} length */
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .split('\0')[0] ?? ''
    const sizeText = field(124, 12).trim()
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid tar entry size.')
    const size = Number.parseInt(sizeText, 8)
    const dataStart = offset + 512
    const next = dataStart + Math.ceil(size / 512) * 512
    if (!Number.isSafeInteger(next) || next > tar.length) throw new Error('Truncated tar entry.')
    const type = field(156, 1)
    if (type === '0' || type === '' || type === '5') {
      const prefix = field(345, 155)
      const path = safePath(`${prefix ? `${prefix}/` : ''}${field(0, 100)}`)
      const stripped = path.split('/').slice(1).join('/')
      if (stripped && !isTaskBoard(stripped)) {
        entries.set(stripped, type === '5' ? null : tar.subarray(dataStart, dataStart + size))
      }
    }
    offset = next
  }
  return entries
}
