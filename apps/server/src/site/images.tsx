import type { Kanso } from '@kanso/core'
import { mediaSrcset, mediaVariantUrl } from '@kanso/shared'
import type { SiteImage } from './themes/types.ts'

/**
 * `sizes` hints. The bundled themes lay content out in a column of at most
 * 42rem, so that is the widest a content image is ever shown.
 */
export const IMAGE_SIZES = {
  /** Body images, covers and hero images: the full content column. */
  content: '(min-width: 44rem) 42rem, calc(100vw - 2rem)',
  /** Image-with-text: half the column once it is side by side. */
  half: '(min-width: 44rem) 21rem, (min-width: 40rem) 50vw, calc(100vw - 2rem)',
} as const

/**
 * `<img>` that lets the browser pick a stored variant that fits. Width and
 * height are always emitted when known, so the page does not jump while the
 * image loads. `eager` is for the image most likely to be the largest paint.
 */
export function ResponsiveImg({
  image,
  class: className,
  sizes = IMAGE_SIZES.content,
  eager = false,
}: {
  image: SiteImage
  class?: string
  sizes?: string
  eager?: boolean
}) {
  const srcset = mediaSrcset(image)
  return (
    <img
      class={className}
      src={image.url}
      srcset={srcset}
      sizes={srcset ? sizes : undefined}
      alt={image.alt ?? ''}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading={eager ? undefined : 'lazy'}
      decoding="async"
      fetchpriority={eager ? 'high' : undefined}
    />
  )
}

/** A small rendition (avatars and the like): the lightest variant that is still sharp. */
export function Thumbnail({
  image,
  class: className,
  minWidth = 480,
}: {
  image: SiteImage
  class?: string
  minWidth?: number
}) {
  return (
    <img
      class={className}
      src={mediaVariantUrl(image, minWidth)}
      alt={image.alt ?? ''}
      loading="lazy"
      decoding="async"
    />
  )
}

// A whole `<img>` tag the way a browser reads it: a `>` inside a quoted
// attribute value (possible in a raw HTML block) does not end the tag.
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/g
const MEDIA_SRC = /\ssrc=(["'])(\/media\/[A-Za-z0-9/._-]+)\1/

/**
 * Make the images of a rendered rich-text body responsive. Body HTML is
 * stored at save time, before any variant may exist, so `srcset`, `sizes`
 * and the dimensions are added here at request time — one query for all the
 * images of the page, none when the body has no image. Existing content
 * benefits without being saved again.
 */
export async function withResponsiveImages(kanso: Kanso, html: string): Promise<string> {
  if (!html.includes('<img')) return html
  const keys = [...html.matchAll(IMG_TAG)].flatMap((match) => {
    const src = MEDIA_SRC.exec(match[0])?.[2]
    return src ? [src.slice(1)] : []
  })
  if (keys.length === 0) return html

  const byUrl = new Map((await kanso.media.findByKeys(keys)).map((item) => [item.url, item]))
  return html.replace(IMG_TAG, (tag) => {
    const src = MEDIA_SRC.exec(tag)?.[2]
    const item = src ? byUrl.get(src) : undefined
    if (!item) return tag
    const attributes: string[] = []
    const srcset = mediaSrcset(item)
    // An image that brings its own candidates (hand-written HTML) keeps them.
    if (srcset && !/\ssrcset=/.test(tag)) {
      attributes.push(`srcset="${srcset}"`, `sizes="${IMAGE_SIZES.content}"`)
    }
    if (!/\swidth=/.test(tag) && item.width && item.height) {
      attributes.push(`width="${item.width}"`, `height="${item.height}"`)
    }
    if (!/\sdecoding=/.test(tag)) attributes.push('decoding="async"')
    if (attributes.length === 0) return tag
    // `<img … />` stays self-closed.
    const end = tag.endsWith('/>') ? '/>' : '>'
    return `${tag.slice(0, -end.length).trimEnd()} ${attributes.join(' ')}${end}`
  })
}
