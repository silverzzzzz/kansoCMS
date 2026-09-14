import { richTextDocSchema } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import { effectiveExcerpt, extractExcerpt } from './excerpt.ts'

describe('extractExcerpt', () => {
  it('joins document text with normalized block separators', () => {
    const doc = richTextDocSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'A heading' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'First' },
            { type: 'hardBreak' },
            { type: 'text', text: 'paragraph' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
                {
                  type: 'blockquote',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Nested quote' }] },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'ignored code' }] },
        { type: 'rawHtml', attrs: { html: '<p>ignored HTML</p>' } },
        { type: 'image', attrs: { src: '/media/ignored.jpg', alt: 'ignored alt' } },
        { type: 'horizontalRule' },
        { type: 'form', attrs: { slug: 'ignored-form' } },
      ],
    })

    expect(extractExcerpt(doc)).toBe('A heading First paragraph One Two Nested quote')
  })

  it('matches the SEO package HTML cleanup behavior', () => {
    expect(
      extractExcerpt(
        '<h1>Hello&nbsp; world</h1><p>&amp; &lt;safe&gt; &quot;quoted&quot; &#39;ok&#39;</p>',
      ),
    ).toBe('Hello world & <safe> "quoted" \'ok\'')
  })

  it('truncates with one ellipsis inside the maximum length', () => {
    const doc = richTextDocSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'A deliberately long excerpt' }],
        },
      ],
    })

    expect(extractExcerpt(doc, 12)).toBe('A deliberat…')
    expect(extractExcerpt('<p>short</p>', 12)).toBe('short')
  })
})

describe('effectiveExcerpt', () => {
  const bodyJson = richTextDocSchema.parse({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'A deliberately long body excerpt' }],
      },
    ],
  })

  it('prefers and trims a non-blank stored excerpt', () => {
    expect(effectiveExcerpt({ excerpt: '  Explicit excerpt.  ', bodyJson })).toBe(
      'Explicit excerpt.',
    )
  })

  it.each([null, '', '   '])('falls back to the body for %j', (excerpt) => {
    expect(effectiveExcerpt({ excerpt, bodyJson })).toBe('A deliberately long body excerpt')
  })

  it('returns an empty string when the body is null', () => {
    expect(effectiveExcerpt({ excerpt: null, bodyJson: null })).toBe('')
  })

  it('honours maxLength when deriving from the body', () => {
    expect(effectiveExcerpt({ excerpt: null, bodyJson }, 12)).toBe('A deliberat…')
  })
})
