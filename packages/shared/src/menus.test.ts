import { describe, expect, it } from 'vitest'
import { menuHrefSchema, menuItemsSchema } from './menus.ts'

describe('menuHrefSchema', () => {
  it('accepts paths, anchors and http(s) URLs', () => {
    for (const href of ['/company', '#top', 'https://example.com', 'http://x.co/a?b=1']) {
      expect(menuHrefSchema.safeParse(href).success, href).toBe(true)
    }
  })

  it('rejects other schemes and bare text', () => {
    for (const href of ['javascript:alert(1)', 'mailto:a@b.c', 'plain text', '']) {
      expect(menuHrefSchema.safeParse(href).success, href).toBe(false)
    }
  })
})

describe('menuItemsSchema', () => {
  it('defaults children to an empty array', () => {
    const items = menuItemsSchema.parse([{ label: 'About', href: '/about' }])
    expect(items[0]?.children).toEqual([])
  })

  it('keeps nesting to one level through the shape itself', () => {
    const items = menuItemsSchema.parse([
      { label: 'Docs', href: '/docs', children: [{ label: 'API', href: '/docs/api' }] },
    ])
    expect(items[0]?.children).toEqual([{ label: 'API', href: '/docs/api' }])
  })
})
