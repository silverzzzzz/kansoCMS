import { pngBytes, webpBytes } from '@kanso/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, type TestApp } from '../testing.ts'

const context = { allowRawHtml: false }

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null
}

function imageTags(html: string, className?: string): string[] {
  const tags = html.match(/<img\b[^>]*>/g) ?? []
  return className ? tags.filter((tag) => tag.includes(`class="${className}"`)) : tags
}

describe('responsive images', () => {
  let test: TestApp

  beforeEach(async () => {
    test = createTestApp()
    await test.signIn()
  })
  afterEach(() => test.close())

  async function uploadWithVariants() {
    const item = await test.kanso.media.upload({
      bytes: pngBytes(2000, 1000),
      filename: 'photo.png',
      alt: '写真',
    })
    const form = new FormData()
    form.set('w480', new File([webpBytes(480, 240)], 'w480', { type: 'image/webp' }))
    form.set('w960', new File([webpBytes(960, 480)], 'w960', { type: 'image/webp' }))
    form.set('w1600', new File([webpBytes(1600, 800)], 'w1600', { type: 'image/webp' }))
    const response = await test.request(`/api/v1/media/${item.id}/variants`, {
      method: 'PUT',
      body: form,
    })
    return { item, response }
  }

  function bodyWith(src: string) {
    return {
      type: 'doc' as const,
      content: [
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: '本文' }] },
        { type: 'image' as const, attrs: { src, alt: '本文の写真' } },
      ],
    }
  }

  it('stores the variants an upload sends and serves them from /media', async () => {
    const { item, response } = await uploadWithVariants()
    const body = (await response.json()) as {
      item: { variants: { width: number; url: string }[] }
    }

    expect(response.status).toBe(200)
    expect(body.item.variants.map((variant) => variant.width)).toEqual([480, 960, 1600])
    const variant = await test.request(body.item.variants[0]?.url ?? '')
    expect(variant.status).toBe(200)
    expect(variant.headers.get('cache-control')).toContain('immutable')
    // The library lists them as well, for thumbnails.
    const list = (await (await test.request('/api/v1/media')).json()) as {
      items: { id: number; variants: unknown[] }[]
    }
    expect(list.items.find((row) => row.id === item.id)?.variants).toHaveLength(3)
  })

  it('rejects variants that are not what they claim to be', async () => {
    const item = await test.kanso.media.upload({
      bytes: pngBytes(2000, 1000),
      filename: 'photo.png',
      alt: null,
    })
    const send = (name: string, bytes: ArrayBuffer) => {
      const form = new FormData()
      form.set(name, new File([bytes], name))
      return test.request(`/api/v1/media/${item.id}/variants`, { method: 'PUT', body: form })
    }

    expect((await send('w480', webpBytes(480, 480))).status).toBe(400)
    expect((await send('w480', pngBytes(480, 240))).status).toBe(400)
    expect((await send('other', webpBytes(480, 240))).status).toBe(400)
    test.signOut()
    expect((await send('w480', webpBytes(480, 240))).status).toBe(401)
  })

  it('adds srcset, sizes and dimensions to images in a stored body', async () => {
    const { item } = await uploadWithVariants()
    // Saved before the body knew anything about variants.
    await test.kanso.pages.create(
      { title: 'About', slug: 'about', status: 'published', bodyJson: bodyWith(item.url) },
      context,
    )
    test.signOut()

    const html = await (await test.request('/about')).text()
    const [tag] = imageTags(html)

    expect(tag).toBeDefined()
    const base = item.url.replace(/\.png$/, '')
    expect(attribute(tag ?? '', 'srcset')).toBe(
      `${base}.w480.webp 480w, ${base}.w960.webp 960w, ${base}.w1600.webp 1600w, ${item.url} 2000w`,
    )
    expect(attribute(tag ?? '', 'sizes')).toContain('42rem')
    expect(attribute(tag ?? '', 'width')).toBe('2000')
    expect(attribute(tag ?? '', 'height')).toBe('1000')
    expect(attribute(tag ?? '', 'loading')).toBe('lazy')
    expect(attribute(tag ?? '', 'decoding')).toBe('async')
    expect(attribute(tag ?? '', 'alt')).toBe('本文の写真')
  })

  it('leaves an image without variants alone apart from its dimensions', async () => {
    const item = await test.kanso.media.upload({
      bytes: pngBytes(300, 200),
      filename: 'small.png',
      alt: null,
    })
    await test.kanso.pages.create(
      { title: 'Small', slug: 'small', status: 'published', bodyJson: bodyWith(item.url) },
      context,
    )

    const [tag] = imageTags(await (await test.request('/small')).text())
    expect(attribute(tag ?? '', 'srcset')).toBeNull()
    expect(attribute(tag ?? '', 'width')).toBe('300')
    expect(attribute(tag ?? '', 'src')).toBe(item.url)
  })

  it('reads hand-written image tags the way a browser does', async () => {
    const { item } = await uploadWithVariants()
    const html = [
      `<img src="${item.url}" alt="a > b" title='x > y'>`,
      `<img src="${item.url}" srcset="${item.url} 2x" width="10" />`,
      `<img src='${item.url}' alt="single quotes" width=20 decoding=sync srcset=x>`,
      '<img src="https://example.com/a.png" alt="elsewhere">',
    ].join('\n')
    await test.kanso.pages.create(
      {
        title: 'Raw',
        slug: 'raw',
        status: 'published',
        bodyJson: { type: 'doc', content: [{ type: 'rawHtml', attrs: { html } }] },
      },
      { allowRawHtml: true },
    )
    test.signOut()

    const body = await (await test.request('/raw')).text()
    const base = item.url.replace(/\.png$/, '')

    // A `>` inside a quoted value does not end the tag: the attributes land after it.
    expect(body).toContain(
      `<img src="${item.url}" alt="a > b" title='x > y' srcset="${base}.w480.webp 480w, `,
    )
    // Its own srcset and width are kept; the tag stays self-closed.
    expect(body).toContain(
      `<img src="${item.url}" srcset="${item.url} 2x" width="10" decoding="async"/>`,
    )
    // Nothing to add: the tag is returned as it was written.
    expect(body).toContain(
      `<img src='${item.url}' alt="single quotes" width=20 decoding=sync srcset=x>`,
    )
    expect(body).toContain('<img src="https://example.com/a.png" alt="elsewhere">')
  })

  it('renders covers and section images responsively', async () => {
    const { item } = await uploadWithVariants()
    const type = await test.kanso.postTypes.create({ slug: 'news', name: 'News' })
    await test.kanso.posts.create(
      {
        postTypeId: type.id,
        slug: 'hello',
        title: 'Hello',
        status: 'published',
        coverMediaId: item.id,
      },
      { ...context, authorId: null },
    )
    await test.kanso.pages.create(
      {
        title: 'Home',
        slug: 'home',
        status: 'published',
        sections: [
          { id: 's1', type: 'hero', settings: { heading: 'Welcome', image: item.id } },
          { id: 's2', type: 'image_with_text', settings: { heading: 'About', image: item.id } },
        ],
      },
      context,
    )
    test.signOut()

    const [cover] = imageTags(await (await test.request('/news/hello')).text(), 'post-cover')
    const home = await (await test.request('/')).text()
    const [hero] = imageTags(home, 'section-hero-image')
    const [half] = imageTags(home, 'section-image')

    // The cover and the hero are what the page paints first: fetched eagerly.
    for (const tag of [cover, hero]) {
      expect(attribute(tag ?? '', 'srcset')).toContain('.w960.webp 960w')
      expect(attribute(tag ?? '', 'fetchpriority')).toBe('high')
      expect(attribute(tag ?? '', 'loading')).toBeNull()
      expect(attribute(tag ?? '', 'width')).toBe('2000')
    }
    expect(attribute(half ?? '', 'loading')).toBe('lazy')
    expect(attribute(half ?? '', 'sizes')).toContain('21rem')
  })

  it('costs one extra query for a body with images and none without', async () => {
    const { item } = await uploadWithVariants()
    await test.kanso.pages.create(
      { title: 'With', slug: 'with', status: 'published', bodyJson: bodyWith(item.url) },
      context,
    )
    await test.kanso.pages.create(
      { title: 'Without', slug: 'without', status: 'published' },
      context,
    )
    test.signOut()

    test.resetQueries()
    await test.request('/without')
    await test.flush()
    const without = test.queries()
    test.resetQueries()
    await test.request('/with')
    await test.flush()

    expect(test.queries()).toBe(without + 1)
  })

  it('describes an image from its lighter variant when asked for alt text', async () => {
    const run = vi.fn().mockResolvedValue({ response: '海辺の写真' })
    test.close()
    test = createTestApp({ AI: { run } })
    await test.signIn()
    const { item } = await uploadWithVariants()
    // Too large to send as it is — only possible through a variant.
    test.exec(`update media set size = 9000000 where id = ${item.id}`)

    const response = await test.request('/api/v1/ai/alt', {
      method: 'POST',
      json: { mediaId: item.id },
    })

    expect(response.status).toBe(200)
    const payload = run.mock.calls[0]?.[1] as {
      messages: { content: { image_url: { url: string } }[] }[]
    }
    expect(
      payload.messages[1]?.content[0]?.image_url.url.startsWith('data:image/webp;base64,'),
    ).toBe(true)
  })
})
