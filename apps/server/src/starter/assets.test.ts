import { describe, expect, it, vi } from 'vitest'
import type { Bindings } from '../env.ts'
import { starterImageLoader } from './assets.ts'

function envWith(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response)
  return { env: { ASSETS: { fetch } } as unknown as Bindings, fetch }
}

describe('starterImageLoader', () => {
  it('reads the bundled image from Static Assets on the request origin', async () => {
    const { env, fetch } = envWith(new Response(new Uint8Array([82, 73, 70, 70])))
    const bytes = await starterImageLoader(
      env,
      'https://cms.example.com/api/v1/starter',
    )('hero.webp')
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([82, 73, 70, 70]))
    expect(fetch).toHaveBeenCalledWith('https://cms.example.com/starter/hero.webp')
  })

  it('fails loudly when the image is missing', async () => {
    const { env } = envWith(new Response('Not found', { status: 404 }))
    await expect(
      starterImageLoader(env, 'https://cms.example.com/api/v1/setup')('hero.webp'),
    ).rejects.toThrow('Starter image hero.webp is not available (HTTP 404)')
  })
})
