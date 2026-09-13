import type { R2Range } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'

/**
 * Resolves the byte span R2 actually returned so the 206 can carry Content-Range.
 * Checks values rather than `in`: the runtime object owns every key, some set to undefined.
 */
function resolveRange(range: R2Range, size: number): { start: number; end: number } {
  const suffix = 'suffix' in range ? range.suffix : undefined
  if (suffix !== undefined) return { start: Math.max(size - suffix, 0), end: size - 1 }
  const start = ('offset' in range ? range.offset : undefined) ?? 0
  const length = 'length' in range ? range.length : undefined
  const end = length === undefined ? size - 1 : Math.min(start + length, size) - 1
  return { start, end }
}

/**
 * Serves R2 objects at /media/<key>. Keys are immutable (a replaced file gets
 * a new key), so responses are cached aggressively. Conditional requests and
 * ranges are delegated to R2 via `onlyIf` / `range`.
 */
export const media = new Hono<AppEnv>().get('/*', async (c) => {
  const key = c.req.path.replace(/^\/media\//, '')
  if (!key || key.includes('..')) return c.notFound()

  const object = await c.env.MEDIA.get(`media/${key}`, {
    onlyIf: c.req.raw.headers,
    range: c.req.raw.headers,
  })
  if (!object) return c.notFound()

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  if (!headers.get('content-type')) headers.set('content-type', 'application/octet-stream')
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('accept-ranges', 'bytes')

  // `body` is absent when a precondition (If-None-Match etc.) short-circuits.
  if (!('body' in object) || !object.body) {
    return new Response(null, { status: 304, headers })
  }
  // R2 answers an unsatisfiable or absent Range with the whole object (and the
  // local emulator always fills `range`), so only send 206 for a real partial span.
  if (c.req.header('range') && object.range) {
    const { start, end } = resolveRange(object.range, object.size)
    if (start > 0 || end < object.size - 1) {
      headers.set('content-range', `bytes ${start}-${end}/${object.size}`)
      headers.set('content-length', String(end - start + 1))
      return new Response(object.body, { status: 206, headers })
    }
  }
  headers.set('content-length', String(object.size))
  return new Response(object.body, { status: 200, headers })
})
