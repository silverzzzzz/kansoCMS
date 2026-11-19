import type { R2Bucket } from '@cloudflare/workers-types'
import { createKanso } from '../index.ts'
import { createTestD1 } from './d1.ts'

export { SoftAuthenticator } from '../auth/soft-authenticator.ts'
export { createTestD1, type TestD1 } from './d1.ts'
export { jpegBytes, pngBytes, webpBytes } from './images.ts'

interface StoredObject {
  bytes: Uint8Array
  contentType: string | undefined
  uploaded: Date
}

/** Test-only R2: an in-memory map behind the bucket methods the services call. */
export function createTestBucket() {
  const objects = new Map<string, StoredObject>()

  async function toBytes(value: unknown): Promise<Uint8Array> {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (typeof value === 'string') return new TextEncoder().encode(value)
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer())
    throw new Error('Unsupported R2 body in the test bucket')
  }

  const bucket = {
    async put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, {
        bytes: await toBytes(value),
        contentType: options?.httpMetadata?.contentType,
        uploaded: new Date(),
      })
      return { key }
    },
    /** Keys in order, like R2; one page is enough for tests. */
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? ''
      return {
        objects: [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, stored]) => ({
            key,
            size: stored.bytes.byteLength,
            uploaded: stored.uploaded,
          })),
        truncated: false,
        delimitedPrefixes: [],
      }
    },
    async get(key: string) {
      const stored = objects.get(key)
      if (!stored) return null
      return {
        key,
        size: stored.bytes.byteLength,
        httpEtag: `"${key}"`,
        httpMetadata: { contentType: stored.contentType },
        writeHttpMetadata(headers: Headers) {
          if (stored.contentType) headers.set('content-type', stored.contentType)
        },
        body: new Blob([stored.bytes.slice()]).stream(),
        arrayBuffer: async () => stored.bytes.slice().buffer,
      }
    },
    async head(key: string) {
      const stored = objects.get(key)
      return stored ? { key, size: stored.bytes.byteLength } : null
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    },
  }

  return { bucket: bucket as unknown as R2Bucket, objects }
}

/**
 * A full `Kanso` over an in-memory database with every migration applied —
 * for service tests that should exercise real SQL instead of mocks.
 */
export function createTestKanso() {
  const database = createTestD1()
  const storage = createTestBucket()
  const kanso = createKanso({ db: database.d1, media: storage.bucket })
  return { kanso, ...database, bucket: storage.bucket, objects: storage.objects }
}

export type TestKanso = ReturnType<typeof createTestKanso>
