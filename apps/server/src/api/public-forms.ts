import { KansoError } from '@kanso/core'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from '../env.ts'
import { submitForm } from '../forms/submit.ts'

const MAX_BODY_BYTES = 64 * 1024

function bodyTooLarge(): never {
  throw KansoError.validation('Request body too large')
}

function checkContentLength(request: Request): void {
  const header = request.headers.get('content-length')
  if (header !== null && Number(header) > MAX_BODY_BYTES) bodyTooLarge()
}

function formDataValues(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  for (const [key, value] of formData) {
    if (typeof value === 'string') raw[key] = value
  }
  return raw
}

function jsonValues(text: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw KansoError.validation('Invalid request body')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw KansoError.validation('Invalid request body')
  }
  return value as Record<string, unknown>
}

/**
 * Reads the body while counting bytes so a chunked request without a
 * Content-Length header cannot make the Worker buffer an unbounded body.
 */
async function readBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  checkContentLength(request)
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(new ArrayBuffer(0))

  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_BODY_BYTES) {
      await reader.cancel()
      bodyTooLarge()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(new ArrayBuffer(received))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const bytes = await readBody(request)

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType === 'application/json') {
    return jsonValues(new TextDecoder().decode(bytes))
  }
  if (contentType === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(bytes)))
  }
  if (contentType === 'multipart/form-data') {
    try {
      const parsed = new Request(request.url, {
        method: 'POST',
        headers: { 'content-type': request.headers.get('content-type') ?? '' },
        body: bytes,
      })
      return formDataValues(await parsed.formData())
    } catch {
      throw KansoError.validation('Invalid request body')
    }
  }
  throw KansoError.validation('Unsupported Content-Type')
}

export const publicForms = new Hono<AppEnv>()
  .use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  )
  .post('/:slug/submissions', async (c) => {
    const form = await c.var.kanso.forms.findBySlug(c.req.param('slug'))
    if (!form) throw KansoError.notFound('Form')

    const result = await submitForm(c, form, await parseBody(c.req.raw))
    return c.json({ ok: true, message: result.message, redirectUrl: result.redirectUrl }, 201)
  })
