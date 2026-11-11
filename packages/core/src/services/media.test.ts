import { mediaSrcset, mediaVariantUrl } from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { jpegBytes, pngBytes, webpBytes } from '../testing/images.ts'
import { createTestKanso, type TestKanso } from '../testing/index.ts'

describe('media variants', () => {
  let test: TestKanso

  beforeEach(() => {
    test = createTestKanso()
  })
  afterEach(() => test.close())

  function upload(bytes: ArrayBuffer, filename = 'photo.png') {
    return test.kanso.media.upload({ bytes, filename, alt: null })
  }

  it('stores variants next to the original and lists them on the item', async () => {
    const original = await upload(pngBytes(2000, 1000))
    const item = await test.kanso.media.setVariants(original.id, [
      { width: 960, bytes: webpBytes(960, 480) },
      { width: 480, bytes: webpBytes(480, 240) },
      { width: 1600, bytes: webpBytes(1600, 800) },
    ])

    const base = original.url.replace(/\.png$/, '')
    expect(item.variants).toEqual([
      { width: 480, height: 240, url: `${base}.w480.webp` },
      { width: 960, height: 480, url: `${base}.w960.webp` },
      { width: 1600, height: 800, url: `${base}.w1600.webp` },
    ])
    expect(test.objects.get(`${base.slice(1)}.w960.webp`)?.contentType).toBe('image/webp')
    expect(mediaSrcset(item)).toBe(
      `${base}.w480.webp 480w, ${base}.w960.webp 960w, ${base}.w1600.webp 1600w, ${original.url} 2000w`,
    )
    expect(mediaVariantUrl(item, 480)).toBe(`${base}.w480.webp`)
    expect(mediaVariantUrl(item, 1000)).toBe(`${base}.w1600.webp`)
    expect(mediaVariantUrl(item, 4000)).toBe(original.url)
  })

  it('only accepts smaller copies of the same picture', async () => {
    const original = await upload(pngBytes(1200, 600))
    const set = (width: number, bytes: ArrayBuffer) =>
      test.kanso.media.setVariants(original.id, [{ width, bytes }])

    await expect(set(1600, webpBytes(1600, 800))).rejects.toThrow(/does not fit/) // not smaller
    await expect(set(700, webpBytes(700, 350))).rejects.toThrow(/does not fit/) // not a variant width
    await expect(set(480, webpBytes(480, 480))).rejects.toThrow(/does not fit/) // other proportions
    await expect(set(480, webpBytes(960, 480))).rejects.toThrow(/not 480 pixels wide/)
    await expect(set(480, pngBytes(480, 240))).rejects.toThrow(/WebP or JPEG/)
    await expect(set(480, new ArrayBuffer(0))).rejects.toThrow(/empty or too large/)
    await expect(
      test.kanso.media.setVariants(original.id, [
        { width: 480, bytes: webpBytes(480, 240) },
        { width: 480, bytes: webpBytes(480, 240) },
      ]),
    ).rejects.toThrow(/sent twice/)
    await expect(test.kanso.media.setVariants(999, [])).rejects.toThrow(/not found/)
    expect((await test.kanso.media.get(original.id)).variants).toEqual([])
    // A JPEG variant is fine (browsers without a WebP encoder).
    await expect(set(480, jpegBytes(480, 240))).resolves.toMatchObject({
      variants: [{ width: 480, height: 240 }],
    })
  })

  it('accepts the turned shape for a photo stored with its unrotated size', async () => {
    const original = await upload(pngBytes(4000, 3000))
    const item = await test.kanso.media.setVariants(original.id, [
      { width: 480, bytes: webpBytes(480, 640) },
    ])
    expect(item.variants).toEqual([expect.objectContaining({ width: 480, height: 640 })])
  })

  it('records the displayed size of a JPEG with an EXIF quarter turn', async () => {
    const portrait = await upload(jpegBytes(4000, 3000, 6), 'phone.jpg')
    const landscape = await upload(jpegBytes(4000, 3000, 1), 'camera.jpg')
    expect([portrait.width, portrait.height]).toEqual([3000, 4000])
    expect([landscape.width, landscape.height]).toEqual([4000, 3000])
  })

  it('replaces an earlier set and removes the objects it no longer uses', async () => {
    const original = await upload(jpegBytes(2000, 1000), 'photo.jpg')
    await test.kanso.media.setVariants(original.id, [
      { width: 480, bytes: jpegBytes(480, 240) },
      { width: 960, bytes: jpegBytes(960, 480) },
    ])
    const base = original.url.slice(1).replace(/\.jpg$/, '')
    expect(test.objects.has(`${base}.w960.jpg`)).toBe(true)

    const item = await test.kanso.media.setVariants(original.id, [
      { width: 480, bytes: webpBytes(480, 240) },
    ])

    expect(item.variants.map((variant) => variant.url)).toEqual([`/${base}.w480.webp`])
    expect([...test.objects.keys()].sort()).toEqual([`${base}.jpg`, `${base}.w480.webp`])
  })

  it('deletes the variants together with the original', async () => {
    const original = await upload(pngBytes(2000, 1000))
    await test.kanso.media.setVariants(original.id, [{ width: 480, bytes: webpBytes(480, 240) }])
    expect(test.objects.size).toBe(2)

    await test.kanso.media.delete(original.id)

    expect(test.objects.size).toBe(0)
    await expect(test.kanso.media.get(original.id)).rejects.toThrow(/not found/)
  })

  it('leaves nothing behind when the image is deleted while its variants arrive', async () => {
    const original = await upload(pngBytes(2000, 1000))
    const bucket = test.bucket as unknown as { put: (...args: unknown[]) => Promise<unknown> }
    const put = bucket.put.bind(bucket)
    bucket.put = async (...args) => {
      // The row goes away between the check and the write.
      test.exec('delete from media')
      return put(...args)
    }

    await expect(
      test.kanso.media.setVariants(original.id, [{ width: 480, bytes: webpBytes(480, 240) }]),
    ).rejects.toThrow(/not found/)
    expect([...test.objects.keys()]).toEqual([original.url.slice(1)])
  })

  it('refuses variants for files that are not resizable images', async () => {
    test.exec(
      `insert into media (r2_key, filename, mime, size) values ('media/a.pdf', 'a.pdf', 'application/pdf', 10)`,
    )
    await expect(
      test.kanso.media.setVariants(1, [{ width: 480, bytes: webpBytes(480, 240) }]),
    ).rejects.toThrow(/cannot have image variants/)
  })

  it('looks up many keys in a couple of queries', async () => {
    const values = Array.from(
      { length: 120 },
      (_, index) => `('media/k-${index}.png', 'k.png', 'image/png', 10)`,
    ).join(', ')
    test.exec(`insert into media (r2_key, filename, mime, size) values ${values}`)
    const keys = Array.from({ length: 120 }, (_, index) => `media/k-${index}.png`)

    test.resetQueries()
    const found = await test.kanso.media.findByKeys([...keys, ...keys, 'media/missing.png'])

    expect(found).toHaveLength(120)
    expect(test.queries()).toBe(2)
  })
})
