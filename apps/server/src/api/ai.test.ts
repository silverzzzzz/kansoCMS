import type { Ai } from '@cloudflare/workers-types'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
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
  it('returns 503 when the AI binding is missing', async () => {
    const response = await post({} as Bindings, { kind: 'excerpt', text: '本文です' })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'unavailable', message: 'AI is not configured' },
    })
  })

  it('returns the suggested text from the model', async () => {
    const run = vi.fn().mockResolvedValue({ response: '  要約された抜粋です  ' })
    const env = { AI: { run } as unknown as Ai } as Bindings
    const response = await post(env, { kind: 'excerpt', text: '本文です' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ text: '要約された抜粋です' })
    const [model, payload] = run.mock.calls[0] as [string, { messages: unknown[] }]
    expect(model).toBe('@cf/meta/llama-3.1-8b-instruct')
    expect(payload.messages).toHaveLength(2)
  })

  it('uses an English prompt when locale is en', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'Excerpt.' })
    const env = { AI: { run } as unknown as Ai } as Bindings
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
    const env = { AI: { run } as unknown as Ai } as Bindings
    const response = await post(env, { kind: 'title', text: 'x' })

    expect(response.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects empty source text', async () => {
    const env = { AI: { run: vi.fn() } as unknown as Ai } as Bindings
    const response = await post(env, { kind: 'excerpt', text: '  ' })

    expect(response.status).toBe(400)
  })
})
