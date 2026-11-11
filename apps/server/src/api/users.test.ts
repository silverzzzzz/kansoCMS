import { SoftAuthenticator } from '@kanso/core/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, TEST_ORIGIN, type TestApp } from '../testing.ts'

type UserRow = {
  id: number
  email: string
  name: string
  slug: string
  role: 'admin' | 'editor'
  passkeys: number
  linkExpiresAt: string | null
}
type Invited = { item: UserRow; link: { token: string; expiresAt: string } }

describe('users API', () => {
  let test: TestApp
  let admin: { id: number }

  beforeEach(async () => {
    test = createTestApp()
    admin = await test.signIn({ role: 'admin', name: 'Owner' })
    // A passkey is the only way in, so whoever is signed in has one. The test
    // session alone does not, and the "last administrator" rule looks at passkeys.
    const link = await test.kanso.users.issueLink(admin.id)
    await register(link.token, await SoftAuthenticator.create())
  })
  afterEach(() => test.close())

  async function invite(body: Record<string, unknown>) {
    const response = await test.request('/api/v1/users', { method: 'POST', json: body })
    return { response, body: (await response.json()) as Invited }
  }

  async function list() {
    const response = await test.request('/api/v1/users')
    return ((await response.json()) as { items: UserRow[] }).items
  }

  /** What the invitee's browser does with the link: create a passkey and get signed in. */
  async function register(token: string, key: SoftAuthenticator) {
    const optionsResponse = await test.request('/api/v1/auth/passkey-link/options', {
      method: 'POST',
      json: { token },
    })
    if (optionsResponse.status !== 200) return optionsResponse
    const { options } = (await optionsResponse.json()) as {
      options: Parameters<SoftAuthenticator['register']>[0]
    }
    return test.request('/api/v1/auth/passkey-link', {
      method: 'POST',
      json: { token, credential: await key.register(options, TEST_ORIGIN) },
    })
  }

  it('invites a user who registers a passkey through the link and signs in as an editor', async () => {
    const { response, body } = await invite({ email: 'Hana@Example.com', name: 'Hana' })

    expect(response.status).toBe(201)
    expect(body.item).toMatchObject({ email: 'hana@example.com', role: 'editor', slug: 'hana' })
    const expires = new Date(body.link.expiresAt).getTime() - Date.now()
    expect(expires).toBeGreaterThan(6.9 * 86_400_000)
    expect((await list()).find((row) => row.id === body.item.id)).toMatchObject({
      passkeys: 0,
      linkExpiresAt: expect.any(String),
    })

    test.signOut()
    const key = await SoftAuthenticator.create()
    const registered = await register(body.link.token, key)
    expect(registered.status).toBe(200)
    test.adoptSession(registered)

    const me = (await (await test.request('/api/v1/auth/me')).json()) as {
      principal: { user: UserRow }
    }
    expect(me.principal.user).toMatchObject({ email: 'hana@example.com', role: 'editor' })
    // An editor writes content but cannot reach the administrator's screens.
    const page = await test.request('/api/v1/pages', {
      method: 'POST',
      json: { title: 'By Hana', slug: 'by-hana' },
    })
    expect(page.status).toBe(201)
    expect((await test.request('/api/v1/settings')).status).toBe(403)
    expect((await test.request('/api/v1/users')).status).toBe(403)
    expect((await test.request('/api/v1/api-keys')).status).toBe(403)

    // The link is spent.
    test.signOut()
    expect((await register(body.link.token, await SoftAuthenticator.create())).status).toBe(404)
  })

  it('rejects a second user with the same email address', async () => {
    await invite({ email: 'hana@example.com', name: 'Hana' })
    const again = await invite({ email: 'HANA@example.com', name: 'Other' })
    expect(again.response.status).toBe(409)
  })

  it('gives same-named users distinct author slugs', async () => {
    const first = await invite({ email: 'a@example.com', name: 'Hana Sato' })
    const second = await invite({ email: 'b@example.com', name: 'Hana Sato' })
    const japanese = await invite({ email: 'c@example.com', name: '佐藤 花' })
    expect([first.body.item.slug, second.body.item.slug, japanese.body.item.slug]).toEqual([
      'hana-sato',
      'hana-sato-2',
      'user',
    ])
  })

  it('re-issues a link, which cancels the previous one', async () => {
    const { body } = await invite({ email: 'hana@example.com', name: 'Hana' })
    const reissued = await test.request(`/api/v1/users/${body.item.id}/link`, { method: 'POST' })
    const fresh = (await reissued.json()) as Invited

    expect(reissued.status).toBe(201)
    test.signOut()
    expect((await register(body.link.token, await SoftAuthenticator.create())).status).toBe(404)
    expect((await register(fresh.link.token, await SoftAuthenticator.create())).status).toBe(200)
  })

  it('never leaves the site without an administrator who can sign in', async () => {
    const demoteSelf = () =>
      test.request(`/api/v1/users/${admin.id}`, { method: 'PATCH', json: { role: 'editor' } })
    expect((await demoteSelf()).status).toBe(409)

    // An invited administrator has no passkey yet, so they could not take over.
    const { body } = await invite({ email: 'second@example.com', name: 'Second', role: 'admin' })
    expect((await demoteSelf()).status).toBe(409)

    // Once they have registered, the first administrator can step down…
    const registered = await register(body.link.token, await SoftAuthenticator.create())
    expect(registered.status).toBe(200)
    expect((await demoteSelf()).status).toBe(200)
    // …and is an editor from the very next request.
    expect((await test.request('/api/v1/users')).status).toBe(403)
    const roles = (await test.kanso.users.list()).map((row) => [row.id, row.role])
    expect(roles).toEqual([
      [admin.id, 'editor'],
      [body.item.id, 'admin'],
    ])
  })

  it('refuses to remove the only administrator who can sign in', async () => {
    const invited = await invite({ email: 'second@example.com', name: 'Second', role: 'admin' })
    const type = await test.kanso.postTypes.create({ slug: 'news', name: 'News' })
    const post = await test.kanso.posts.create(
      { postTypeId: type.id, slug: 'by-owner', title: 'By owner', status: 'draft' },
      { allowRawHtml: false, authorId: admin.id },
    )

    // The API never gets here (nobody can remove themselves); the rule also
    // has to hold when two administrators remove each other at the same time.
    await expect(
      test.kanso.users.remove(admin.id, { actorId: invited.body.item.id }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await list()).map((row) => row.email)).toContain('admin@example.com')
    // Nothing of the refused removal happened: the posts keep their author.
    expect((await test.kanso.posts.get(post.id)).authorId).toBe(admin.id)

    // An invited administrator can be removed: the one who invited them remains.
    const removed = await test.request(`/api/v1/users/${invited.body.item.id}`, {
      method: 'DELETE',
    })
    expect(removed.status).toBe(200)
  })

  it('removes a user with their sessions and hands their posts over on request', async () => {
    const { body } = await invite({ email: 'hana@example.com', name: 'Hana' })
    const other = await invite({ email: 'ken@example.com', name: 'Ken' })
    const type = await test.kanso.postTypes.create({ slug: 'news', name: 'News' })
    const create = (slug: string, authorId: number) =>
      test.kanso.posts.create(
        { postTypeId: type.id, slug, title: slug, status: 'published' },
        { allowRawHtml: false, authorId },
      )
    const kept = await create('by-hana', body.item.id)
    const orphaned = await create('by-ken', other.body.item.id)
    const session = await test.kanso.auth.createSession(body.item.id)

    expect((await test.request(`/api/v1/users/${admin.id}`, { method: 'DELETE' })).status).toBe(400)
    const handedOver = await test.request(`/api/v1/users/${body.item.id}?reassignTo=${admin.id}`, {
      method: 'DELETE',
    })
    const plain = await test.request(`/api/v1/users/${other.body.item.id}`, { method: 'DELETE' })

    expect(handedOver.status).toBe(200)
    expect(plain.status).toBe(200)
    expect((await test.kanso.posts.get(kept.id)).authorId).toBe(admin.id)
    expect((await test.kanso.posts.get(orphaned.id)).authorId).toBeNull()
    expect(await test.kanso.auth.getSessionUser(session.token)).toBeNull()
    expect((await list()).map((row) => row.email)).toEqual(['admin@example.com'])
  })

  it('is closed to editors and API keys', async () => {
    const key = await test.kanso.auth.createApiKey({ name: 'ci', scope: 'write' })
    test.signOut()
    expect(
      (await test.request('/api/v1/users', { headers: { 'x-api-key': key.key } })).status,
    ).toBe(403)
    const invited = await test.request('/api/v1/users', {
      method: 'POST',
      headers: { 'x-api-key': key.key },
      json: { email: 'x@example.com', name: 'X', role: 'admin' },
    })
    expect(invited.status).toBe(403)

    await test.signIn({ role: 'editor', email: 'editor@example.com' })
    expect((await test.request('/api/v1/users')).status).toBe(403)
  })

  it('records who was invited in the activity log', async () => {
    await invite({ email: 'hana@example.com', name: 'Hana', role: 'admin' })
    const [entry] = await test.kanso.activity.list(1)
    expect(entry).toMatchObject({ actor: 'Owner', action: 'create', targetType: 'user' })
    expect(entry?.summary).toBe('ユーザー「Hana」を招待 (管理者)')
  })
})
