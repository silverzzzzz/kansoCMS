import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.ts'
import { relyingParty } from './relying-party.ts'

const app = new Hono<AppEnv>().post('/rp', (c) => c.json(relyingParty(c, 'Shop')))

async function rpFor(url: string, headers: Record<string, string> = {}) {
  return (await app.request(url, { method: 'POST', headers })).json()
}

describe('relyingParty', () => {
  it('uses the request URL', async () => {
    expect(await rpFor('https://example.com/rp')).toEqual({
      id: 'example.com',
      origin: 'https://example.com',
      name: 'Shop',
    })
  })

  it('never takes the origin from headers outside localhost', async () => {
    expect(await rpFor('https://example.com/rp', { origin: 'https://evil.example' })).toEqual({
      id: 'example.com',
      origin: 'https://example.com',
      name: 'Shop',
    })
  })

  it('accepts the admin dev server origin on localhost', async () => {
    expect(await rpFor('http://localhost:5173/rp', { origin: 'http://localhost:5174' })).toEqual({
      id: 'localhost',
      origin: 'http://localhost:5174',
      name: 'Shop',
    })
  })

  it.each([
    'http://evil.localhost:5174',
    'http://127.0.0.1:5174',
    'null',
    'http://localhost:5174/x',
  ])('ignores the origin %s on localhost', async (origin) => {
    expect(await rpFor('http://localhost:5173/rp', { origin })).toMatchObject({
      origin: 'http://localhost:5173',
    })
  })
})
