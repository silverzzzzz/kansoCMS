import { describe, expect, it } from 'vitest'
import type { RichTextDoc } from './richtext.ts'
import { extractToc, injectHeadingIds } from './toc.ts'

const doc = (content: RichTextDoc['content']): RichTextDoc => ({ type: 'doc', content })

const heading = (level: 1 | 2 | 3 | 4, text: string) => ({
  type: 'heading' as const,
  attrs: { level },
  content: [{ type: 'text' as const, text }],
})

describe('extractToc', () => {
  it('collects h2 and h3 in document order with positional ids', () => {
    const result = extractToc(
      doc([
        heading(1, 'Title'),
        heading(2, 'Intro'),
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        heading(3, 'Detail'),
        heading(4, 'Skipped'),
        heading(2, 'Outro'),
      ]),
    )
    expect(result).toEqual([
      { id: 'h-1', level: 2, text: 'Intro' },
      { id: 'h-2', level: 3, text: 'Detail' },
      { id: 'h-3', level: 2, text: 'Outro' },
    ])
  })

  it('keeps numbering aligned when a heading is empty', () => {
    const result = extractToc(doc([heading(2, ''), heading(2, 'Real')]))
    expect(result).toEqual([{ id: 'h-2', level: 2, text: 'Real' }])
  })

  it('flattens marks inside headings', () => {
    const result = extractToc(
      doc([
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'Bold ' },
            { type: 'text', text: 'heading', marks: [{ type: 'bold' }] },
          ],
        },
      ]),
    )
    expect(result[0]?.text).toBe('Bold heading')
  })

  it('returns an empty list for missing or empty docs', () => {
    expect(extractToc(null)).toEqual([])
    expect(extractToc(doc([]))).toEqual([])
  })
})

describe('injectHeadingIds', () => {
  it('adds sequential ids to h2 and h3 open tags only', () => {
    const html = '<h1>T</h1><h2>A</h2><p>x</p><h3>B</h3><h4>C</h4><h2>D</h2>'
    expect(injectHeadingIds(html)).toBe(
      '<h1>T</h1><h2 id="h-1">A</h2><p>x</p><h3 id="h-2">B</h3><h4>C</h4><h2 id="h-3">D</h2>',
    )
  })

  it('leaves html without headings untouched', () => {
    expect(injectHeadingIds('<p>Body.</p>')).toBe('<p>Body.</p>')
  })
})
