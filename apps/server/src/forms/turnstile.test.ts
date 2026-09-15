import type { KansoError } from '@kanso/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyTurnstile } from './turnstile.ts'

const failureMessage = 'Turnstile verification failed'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyTurnstile', () => {
  it('sends a form-encoded verification request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    await verifyTurnstile('test-secret', 'test-token', '203.0.113.10', failureMessage)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    const body = new URLSearchParams(String(init?.body))
    expect(Object.fromEntries(body)).toEqual({
      secret: 'test-secret',
      response: 'test-token',
      remoteip: '203.0.113.10',
    })
  })

  it('rejects an unsuccessful verification result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: false })))

    await expect(
      verifyTurnstile('test-secret', 'bad-token', null, failureMessage),
    ).rejects.toMatchObject({
      message: failureMessage,
    } satisfies Partial<KansoError>)
  })

  it('rejects a non-OK verification response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })))

    await expect(
      verifyTurnstile('test-secret', 'test-token', null, failureMessage),
    ).rejects.toMatchObject({
      message: failureMessage,
    } satisfies Partial<KansoError>)
  })

  it('rejects a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')))

    await expect(
      verifyTurnstile('test-secret', 'test-token', null, failureMessage),
    ).rejects.toMatchObject({
      message: failureMessage,
    } satisfies Partial<KansoError>)
  })

  it('rejects a missing token without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyTurnstile('test-secret', '  ', null, failureMessage)).rejects.toMatchObject({
      message: failureMessage,
    } satisfies Partial<KansoError>)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
