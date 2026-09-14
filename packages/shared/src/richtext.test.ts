import { describe, expect, it } from 'vitest'
import { richTextDocSchema } from './richtext.ts'

describe('richTextDocSchema form node', () => {
  it('accepts a form block with a valid slug', () => {
    expect(
      richTextDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'form', attrs: { slug: 'contact' } }],
      }).success,
    ).toBe(true)
  })

  it('rejects a form block with an invalid slug', () => {
    expect(
      richTextDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'form', attrs: { slug: 'Contact form' } }],
      }).success,
    ).toBe(false)
  })
})
