import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.ts'
import { createTestApp, TEST_ORIGIN, type TestApp } from './testing.ts'

describe('CMS over Streamable HTTP', () => {
  let test: TestApp
  const clients: Client[] = []
  beforeEach(() => {
    test = createTestApp()
  })
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    test.close()
  })

  async function connect(key: string, modern = false) {
    const client = new Client(
      { name: 'test', version: '1.0' },
      {
        versionNegotiation: { mode: modern ? { pin: '2026-07-28' } : 'legacy' },
      },
    )
    clients.push(client)
    const transport = new StreamableHTTPClientTransport(new URL('/api/mcp', TEST_ORIGIN), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
      fetch: async (url, init) => {
        const response = await app.request(new Request(url, init), undefined, test.env)
        expect(response.headers.get('cache-control')).toContain('no-store')
        return response
      },
    })
    await client.connect(transport)
    return client
  }

  it('requires a key even with a valid session, rejects foreign origins and does not cache', async () => {
    await test.signIn()
    const unauthenticated = await test.request('/api/mcp', { method: 'POST' })
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('www-authenticate')).toContain('Bearer')
    expect(unauthenticated.headers.get('cache-control')).toBe('no-store')
    expect(
      (
        await test.request('/api/mcp', {
          method: 'POST',
          headers: { origin: 'https://other.example' },
        })
      ).status,
    ).toBe(403)
    expect((await test.request('/api/mcp')).status).toBe(405)
  })

  it('negotiates both protocols and denies writes with a read key', async () => {
    const key = await test.kanso.auth.createApiKey({ name: 'reader', scope: 'read' })
    const legacy = await connect(key.key)
    for (const client of [legacy, await connect(key.key, true)]) {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual([
        'get_content',
        'list_content',
        'list_post_types',
      ])
      expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true)
    }
    const denied = legacy.callTool({
      name: 'create_page_draft',
      arguments: { title: 'Draft', slug: 'draft', body: 'Text' },
    })
    expect(
      await denied.then(
        (result) => JSON.stringify(result.content),
        (error: Error) => error.message,
      ),
    ).toContain('Tool create_page_draft not found')
    expect((await test.kanso.pages.list({})).total).toBe(0)
    await test.kanso.auth.deleteApiKey(key.id)
    await expect(legacy.listTools()).rejects.toThrow()
  })

  it('creates and finds unpublished drafts and records which key created them', async () => {
    const key = await test.kanso.auth.createApiKey({ name: 'writer', scope: 'write' })
    const client = await connect(key.key)
    const type = await test.kanso.postTypes.create({ name: 'News', slug: 'news' })
    const types = await client.callTool({ name: 'list_post_types' })
    expect(types.content).toContainEqual({
      type: 'text',
      text: expect.stringContaining('"slug":"news"'),
    })
    for (const kind of ['page', 'post'] as const) {
      const name = `create_${kind}_draft`
      const args = {
        slug: 'spring',
        title: '春のお知らせ',
        body: '一段落目\n二段落目',
        ...(kind === 'post' ? { postTypeId: type.id } : {}),
      }
      expect(
        (await client.callTool({ name, arguments: { ...args, status: 'published' } })).isError,
      ).toBe(true)
      const created = await client.callTool({ name, arguments: args })
      expect(created.isError).toBeFalsy()
      const repository = kind === 'page' ? test.kanso.pages : test.kanso.posts
      const { items } = await repository.list({ status: 'draft' })
      expect(items).toHaveLength(1)
      const id = items[0]?.id
      const list = await client.callTool({
        name: 'list_content',
        arguments: { kind, q: '春', status: 'draft' },
      })
      expect(list.content).toContainEqual({
        type: 'text',
        text: expect.stringContaining('"total":1'),
      })
      const result = await client.callTool({ name: 'get_content', arguments: { kind, id } })
      expect(result.content).toContainEqual({
        type: 'text',
        text: expect.stringContaining('二段落目'),
      })
      expect((await repository.list({ status: 'published' })).total).toBe(0)
      expect(await test.kanso.activity.list()).toContainEqual(
        expect.objectContaining({
          actor: 'api-key:writer',
          action: 'create',
          targetType: kind,
          targetId: String(id),
        }),
      )
    }
  })
})
