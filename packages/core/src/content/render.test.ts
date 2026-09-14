import { richTextDocSchema } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import { KansoError } from '../errors.ts'
import { renderRichText } from './render.ts'

describe('renderRichText', () => {
  it('renders every supported node type and mark', () => {
    const doc = richTextDocSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            {
              type: 'text',
              text: 'marked',
              marks: [
                { type: 'bold' },
                { type: 'italic' },
                { type: 'underline' },
                { type: 'strike' },
                { type: 'code' },
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com/?a=1&b=2',
                    target: '_blank',
                    rel: 'nofollow noopener',
                    title: 'A "link"',
                  },
                },
              ],
            },
            { type: 'hardBreak' },
            {
              type: 'image',
              attrs: {
                src: '/media/photo.jpg?size=large&crop=1',
                alt: 'A <photo>',
                title: 'Photo',
                width: 640,
                height: 480,
              },
            },
          ],
        },
        { type: 'paragraph' },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet' }] }],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third' }] }],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const value = "<tag>"' }],
        },
        { type: 'horizontalRule' },
        { type: 'image', attrs: { src: 'https://example.com/image.png' } },
        { type: 'form', attrs: { slug: 'contact' } },
      ],
    })

    expect(renderRichText(doc, { allowRawHtml: false })).toBe(
      '<p style="text-align:center"><strong><em><u><s><code>' +
        '<a href="https://example.com/?a=1&amp;b=2" target="_blank" ' +
        'rel="nofollow noopener noreferrer" title="A &quot;link&quot;">marked</a>' +
        '</code></s></u></em></strong><br>' +
        '<img src="/media/photo.jpg?size=large&amp;crop=1" alt="A &lt;photo&gt;" ' +
        'title="Photo" width="640" height="480" loading="lazy"></p>' +
        '<p></p><h2>Heading</h2><ul><li><p>Bullet</p></li></ul>' +
        '<ol start="3"><li><p>Third</p></li></ol>' +
        '<blockquote><p>Quote</p></blockquote>' +
        '<pre><code class="language-typescript">const value = "&lt;tag&gt;"</code></pre>' +
        '<hr><img src="https://example.com/image.png" alt="" loading="lazy">' +
        '<div data-kanso-form="contact"></div>',
    )
  })

  it('escapes script text and omits invalid code-block languages', () => {
    const doc = richTextDocSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '<script>alert("x")</script>' }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'Type Script' },
          content: [{ type: 'text', text: '<script>' }],
        },
      ],
    })

    expect(renderRichText(doc, { allowRawHtml: false })).toBe(
      '<p>&lt;script&gt;alert("x")&lt;/script&gt;</p>' + '<pre><code>&lt;script&gt;</code></pre>',
    )
  })

  it('drops links with unsafe href values and images with unsafe src values', () => {
    const doc = richTextDocSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'unsafe link',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            { type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    })

    expect(renderRichText(doc, { allowRawHtml: false })).toBe('<p>unsafe link</p>')
  })

  it('renders raw HTML only when explicitly allowed', () => {
    const doc = richTextDocSchema.parse({
      type: 'doc',
      content: [{ type: 'rawHtml', attrs: { html: '<aside>Trusted</aside>' } }],
    })

    expect(() => renderRichText(doc, { allowRawHtml: false })).toThrow(
      KansoError.forbidden('Raw HTML blocks are not allowed'),
    )
    expect(renderRichText(doc, { allowRawHtml: true })).toBe('<aside>Trusted</aside>')
  })

  it('rejects unknown nodes and strips unknown attributes', () => {
    expect(
      richTextDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'video', attrs: { src: 'https://example.com/video.mp4' } }],
      }).success,
    ).toBe(false)

    expect(
      richTextDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Unknown', marks: [{ type: 'highlight' }] }],
          },
        ],
      }).success,
    ).toBe(false)

    const result = richTextDocSchema.safeParse({
      type: 'doc',
      unknown: true,
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'left', unknown: true },
          unknown: true,
          content: [{ type: 'text', text: 'Known', unknown: true }],
        },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { textAlign: 'left' },
            content: [{ type: 'text', text: 'Known' }],
          },
        ],
      })
    }
  })
})
