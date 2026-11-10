import { describe, expect, it } from 'vitest'
import { toOgLocale } from './meta.ts'

describe('toOgLocale', () => {
  it.each([
    ['ja', 'ja_JP'],
    ['en', 'en_US'],
    ['fr', 'fr_FR'],
    ['ja-JP', 'ja_JP'],
    ['pt-BR', 'pt_BR'],
    ['zh-TW', 'zh_TW'],
    ['en_GB', 'en_GB'],
  ])('maps %s to %s', (locale, expected) => {
    expect(toOgLocale(locale)).toBe(expected)
  })

  it('passes unparseable input through with underscores', () => {
    expect(toOgLocale('not a locale')).toBe('not a locale')
  })
})
