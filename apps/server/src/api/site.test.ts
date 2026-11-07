import type { Kanso } from '@kanso/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, Bindings } from '../env.ts'
import { onError } from '../middleware/error.ts'
import { siteInfo } from './site.ts'

function testApp(theme = 'default') {
  const kanso: Kanso = Object.assign(Object.create(null), {
    settings: { site: vi.fn().mockResolvedValue({ theme }) },
  })
  return new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('kanso', kanso)
      await next()
    })
    .onError(onError)
    .route('/api/v1/site', siteInfo)
}

describe('section catalog API', () => {
  it('lists the active theme sections with their fields', async () => {
    const response = await testApp().request('/api/v1/site/sections', undefined, {} as Bindings)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      theme: string
      items: { type: string; label: string; fields: { name: string }[] }[]
    }
    expect(body.theme).toBe('default')
    const hero = body.items.find((item) => item.type === 'hero')
    expect(hero?.label).toBe('Hero')
    expect(hero?.fields.map((field) => field.name)).toContain('heading')
    expect(body.items.map((item) => item.type)).toContain('post_list')
  })

  it('serves another theme by query and 404s unknown names', async () => {
    const app = testApp()
    const paper = await app.request('/api/v1/site/sections?theme=paper', undefined, {} as Bindings)
    expect(paper.status).toBe(200)
    await expect(paper.json()).resolves.toMatchObject({ theme: 'paper' })

    const missing = await app.request('/api/v1/site/sections?theme=nope', undefined, {} as Bindings)
    expect(missing.status).toBe(404)
  })
})
