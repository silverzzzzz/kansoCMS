import { readFileSync } from 'node:fs'
import { pngBytes } from '@kanso/core/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_CSP, MEDIA_CSP } from './security-headers.ts'
import { createTestApp, type TestApp } from './testing.ts'

const HEADERS_FILE = new URL('../public/_headers', import.meta.url)

/** `public/_headers` as { pattern: { header: value } }. */
function parseHeadersFile(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {}
  let current: Record<string, string> | null = null
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      current = {}
      rules[line.trim()] = current
      continue
    }
    const separator = line.indexOf(':')
    if (current && separator > 0) {
      current[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
    }
  }
  return rules
}

describe('security headers', () => {
  let test: TestApp

  beforeEach(() => {
    test = createTestApp({
      ASSETS: {
        fetch: () => Promise.resolve(new Response('<!doctype html><div id="root"></div>')),
      },
    })
  })

  afterEach(() => {
    test.close()
  })

  it('serves the same admin CSP from _headers and from the SPA fallback', async () => {
    const rules = parseHeadersFile(readFileSync(HEADERS_FILE, 'utf8'))
    expect(rules['/admin/*']?.['content-security-policy']).toBe(ADMIN_CSP)

    const response = await test.request('/admin/posts/12')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe(ADMIN_CSP)
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })

  it('keeps script to the admin bundle and forbids framing the admin', () => {
    const directives = new Map(
      ADMIN_CSP.split('; ').map((part) => {
        const [name = '', ...values] = part.split(' ')
        return [name, values]
      }),
    )
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('connect-src')).toEqual(["'self'"])
  })

  describe('media', () => {
    async function upload(key: string, body: ArrayBuffer | Uint8Array, contentType: string) {
      await test.bucket.put(`media/${key}`, body, { httpMetadata: { contentType } })
      return test.request(`/media/${key}`)
    }

    it('sandboxes images and lets other origins embed them', async () => {
      const response = await upload('2026/11/a.png', pngBytes(4, 4), 'image/png')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toBe(MEDIA_CSP)
      expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('sandboxes PDFs as well', async () => {
      const response = await upload(
        '2026/11/a.pdf',
        new TextEncoder().encode('%PDF-1.4\n'),
        'application/pdf',
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toBe(MEDIA_CSP)
      expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    })
  })

  it('keeps Cross-Origin-Resource-Policy same-origin everywhere else', async () => {
    const health = await test.request('/api/v1/health')
    expect(health.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    const page = await test.request('/')
    expect(page.headers.get('cross-origin-resource-policy')).toBe('same-origin')
  })
})
