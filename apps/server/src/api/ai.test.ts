import type { Ai } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { createTestApp } from '../testing.ts'
import { ai } from './ai.ts'

function testApp() {
  return new Hono<AppEnv>().onError(onError).route('/api/v1/ai', ai)
}

function post(env: Bindings, body: unknown) {
  return testApp().request(
    '/api/v1/ai/suggest',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe('ai API', () => {
  it('reports whether the AI binding is configured', async () => {
    const off = await testApp().request('/api/v1/ai', {}, {} as Bindings)
    await expect(off.json()).resolves.toEqual({ available: false })

    const env = { AI: { run: vi.fn() } as unknown as Ai } as unknown as Bindings
    const on = await testApp().request('/api/v1/ai', {}, env)
    await expect(on.json()).resolves.toEqual({ available: true })
  })

  it('returns 503 when the AI binding is missing', async () => {
    const response = await post({} as Bindings, { kind: 'excerpt', text: '本文です' })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'unavailable', message: 'AI is not configured' },
    })
  })

  it('returns the suggested text from the model', async () => {
    const run = vi.fn().mockResolvedValue({ response: '  要約された抜粋です  ' })
    const env = { AI: { run } as unknown as Ai } as unknown as Bindings
    const response = await post(env, { kind: 'excerpt', text: '本文です' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ text: '要約された抜粋です' })
    const [model, payload] = run.mock.calls[0] as [string, { messages: unknown[] }]
    expect(model).toBe('@cf/meta/llama-3.1-8b-instruct')
    expect(payload.messages).toHaveLength(2)
  })

  it('uses an English prompt when locale is en', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'Excerpt.' })
    const env = { AI: { run } as unknown as Ai } as unknown as Bindings
    const response = await post(env, { kind: 'excerpt', text: 'body', locale: 'en' })

    expect(response.status).toBe(200)
    const [, payload] = run.mock.calls[0] as [
      string,
      { messages: { role: string; content: string }[] },
    ]
    expect(payload.messages[0]?.content).toMatch(/Output only/)
  })

  it('rejects an unknown kind with a validation error', async () => {
    const run = vi.fn()
    const env = { AI: { run } as unknown as Ai } as unknown as Bindings
    const response = await post(env, { kind: 'title', text: 'x' })

    expect(response.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects empty source text', async () => {
    const env = { AI: { run: vi.fn() } as unknown as Ai } as unknown as Bindings
    const response = await post(env, { kind: 'excerpt', text: '  ' })

    expect(response.status).toBe(400)
  })
})

describe('ai alt text', () => {
  // A 1x1 PNG.
  const PNG = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    ),
    (char) => char.charCodeAt(0),
  )

  async function setup(response: unknown = { response: ' "木のテーブルに置かれた白いカップ" \n' }) {
    const run = vi.fn().mockResolvedValue(response)
    const test = createTestApp({ AI: { run } })
    await test.signIn()
    const media = await test.kanso.media.upload({
      bytes: PNG.buffer as ArrayBuffer,
      filename: 'IMG_0001.png',
      alt: null,
    })
    return { test, run, media }
  }

  it('shows the stored image itself to a vision model', async () => {
    const { test, run, media } = await setup()

    const response = await test.request('/api/v1/ai/alt', {
      method: 'POST',
      json: { mediaId: media.id },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ text: '木のテーブルに置かれた白いカップ' })
    const [model, payload] = run.mock.calls[0] as [
      string,
      { messages: { role: string; content: unknown }[] },
    ]
    expect(model).toBe('@cf/mistralai/mistral-small-3.1-24b-instruct')
    const parts = payload.messages[1]?.content as { type: string; image_url: { url: string } }[]
    expect(parts[0]?.type).toBe('image_url')
    expect(parts[0]?.image_url.url.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true)
    // The file name carries no information about the picture and is not sent.
    expect(JSON.stringify(payload)).not.toContain('IMG_0001')
    test.close()
  })

  it('refuses media a vision model cannot read', async () => {
    const { test, run, media } = await setup()
    test.exec(`update media set mime = 'application/pdf' where id = ${media.id}`)

    const response = await test.request('/api/v1/ai/alt', {
      method: 'POST',
      json: { mediaId: media.id },
    })

    expect(response.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
    test.close()
  })

  it('answers 503 without the AI binding and 404 for unknown media', async () => {
    const off = createTestApp()
    await off.signIn()
    const unavailable = await off.request('/api/v1/ai/alt', {
      method: 'POST',
      json: { mediaId: 1 },
    })
    expect(unavailable.status).toBe(503)
    off.close()

    const { test } = await setup()
    const missing = await test.request('/api/v1/ai/alt', {
      method: 'POST',
      json: { mediaId: 999 },
    })
    expect(missing.status).toBe(404)
    test.close()
  })

  it('requires a signed-in user or API key', async () => {
    const { test, media } = await setup()
    test.signOut()
    const response = await test.request('/api/v1/ai/alt', {
      method: 'POST',
      json: { mediaId: media.id },
    })
    expect(response.status).toBe(401)
    test.close()
  })
})
