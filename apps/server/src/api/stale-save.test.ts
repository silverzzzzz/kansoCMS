import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing.ts'

type PageResponse = { item: { id: number; title: string; updatedAt: string } }

describe('PATCH with baseUpdatedAt', () => {
  let test: TestApp

  beforeEach(async () => {
    test = createTestApp()
    await test.signIn()
  })

  afterEach(() => {
    test.close()
  })

  it('answers 409 stale when the page was saved after the editor loaded it', async () => {
    const created = await test.request('/api/v1/pages', {
      method: 'POST',
      json: { title: 'About', slug: 'about' },
    })
    const { item } = (await created.json()) as PageResponse
    test.exec(`update pages set updated_at = updated_at - 60 where id = ${item.id}`)
    const loaded = (await (await test.request(`/api/v1/pages/${item.id}`)).json()) as PageResponse

    // Another tab saves first.
    const first = await test.request(`/api/v1/pages/${item.id}`, {
      method: 'PATCH',
      json: { title: 'From tab A', baseUpdatedAt: loaded.item.updatedAt },
    })
    expect(first.status).toBe(200)

    const second = await test.request(`/api/v1/pages/${item.id}`, {
      method: 'PATCH',
      json: { title: 'From tab B', baseUpdatedAt: loaded.item.updatedAt },
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: { code: 'stale' } })

    // Choosing to overwrite sends no base.
    const overwrite = await test.request(`/api/v1/pages/${item.id}`, {
      method: 'PATCH',
      json: { title: 'From tab B' },
    })
    expect(overwrite.status).toBe(200)
    expect(((await overwrite.json()) as PageResponse).item.title).toBe('From tab B')
  })

  it('rejects a base that is not a timestamp', async () => {
    const created = await test.request('/api/v1/pages', {
      method: 'POST',
      json: { title: 'About', slug: 'about' },
    })
    const { item } = (await created.json()) as PageResponse
    const response = await test.request(`/api/v1/pages/${item.id}`, {
      method: 'PATCH',
      json: { title: 'X', baseUpdatedAt: 'yesterday' },
    })
    expect(response.status).toBe(400)
  })
})
