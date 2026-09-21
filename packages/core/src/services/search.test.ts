import { describe, expect, it } from 'vitest'
import { EMPTY_DOCUMENT, plainText } from '../content/index.ts'
import { buildSnippet, likePattern, matchExpression, searchTerms, usesMatch } from './search.ts'

describe('search helpers', () => {
  it('splits whitespace and keeps at most eight terms', () => {
    expect(searchTerms('  東京\nタワー\tWorkers　D1 ')).toEqual(['東京', 'タワー', 'Workers', 'D1'])
    expect(searchTerms('  ')).toEqual([])
    expect(searchTerms('1 2 3 4 5 6 7 8 9')).toHaveLength(8)
  })

  it('quotes MATCH syntax as literal AND terms', () => {
    expect(matchExpression(['hello', 'a"b', 'OR'])).toBe('"hello" AND "a""b" AND "OR"')
  })

  it('escapes LIKE wildcards and the escape character', () => {
    expect(likePattern('a%_\\b')).toBe('%a\\%\\_\\\\b%')
  })

  it('uses MATCH only for nonempty queries whose terms are all at least three characters', () => {
    expect(usesMatch(['タワーの', 'workers'])).toBe(true)
    expect(usesMatch(['東京', 'workers'])).toBe(false)
    expect(usesMatch(['a'])).toBe(false)
    expect(usesMatch([])).toBe(false)
  })

  it('extracts the complete body without truncating', () => {
    const text = '本文'.repeat(100)
    expect(
      plainText({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text }] },
          { type: 'paragraph', content: [{ type: 'text', text: '  next\nblock ' }] },
        ],
      }),
    ).toBe(`${text} next block`)
    expect(plainText(EMPTY_DOCUMENT)).toBe('')
  })
})

describe('buildSnippet', () => {
  it('highlights Japanese and repeated case-insensitive terms', () => {
    expect(buildSnippet('東京タワーの案内。 Workers と WORKERS', ['東京', 'workers'])).toEqual([
      { text: '東京', hit: true },
      { text: 'タワーの案内。 ', hit: false },
      { text: 'Workers', hit: true },
      { text: ' と ', hit: false },
      { text: 'WORKERS', hit: true },
    ])
  })

  it('cuts a window around the first query term that occurs', () => {
    expect(buildSnippet('0123456789東京abcdefghijkl', ['absent', '東京'], 3)).toEqual([
      { text: '…', hit: false },
      { text: '789', hit: false },
      { text: '東京', hit: true },
      { text: 'abc', hit: false },
      { text: '…', hit: false },
    ])
    expect(
      buildSnippet('cat 012345 dog 6789', ['dog', 'cat'], 1)
        .map((s) => s.text)
        .join(''),
    ).toBe('… dog …')
  })

  it('collapses whitespace and returns a plain prefix when no term matches', () => {
    expect(buildSnippet('  abc\n def\tghi  ', ['missing'], 3)).toEqual([
      { text: 'abc de', hit: false },
    ])
    expect(buildSnippet('', [])).toEqual([{ text: '', hit: false }])
  })

  it('treats regex and HTML syntax literally and prefers longer overlapping terms', () => {
    expect(buildSnippet('<b>a.b</b> aab', ['a.b'])).toEqual([
      { text: '<b>', hit: false },
      { text: 'a.b', hit: true },
      { text: '</b> aab', hit: false },
    ])
    expect(buildSnippet('Workers', ['work', 'workers'])).toEqual([{ text: 'Workers', hit: true }])
    expect(buildSnippet('東京タワー', ['東京タ', 'タワー'])).toEqual([
      { text: '東京タワー', hit: true },
    ])
    expect(buildSnippet('banana', ['ana'])).toEqual([
      { text: 'b', hit: false },
      { text: 'anana', hit: true },
    ])
  })
})
