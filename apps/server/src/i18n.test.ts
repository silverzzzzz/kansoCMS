import { describe, expect, it } from 'vitest'
import { en, ja, resolveMessages } from './i18n.ts'

function nestedKeys(value: object, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    keys.push(path)
    if (typeof nested === 'object' && nested !== null) keys.push(...nestedKeys(nested, path))
  }
  return keys.sort()
}

describe('resolveMessages', () => {
  it.each(['ja', 'ja-JP', 'JA'])('resolves %s to Japanese', (locale) => {
    expect(resolveMessages(locale)).toBe(ja)
  })

  it.each(['en', 'en-US', 'fr', '', 'not a tag!'])('resolves %s to English', (locale) => {
    expect(resolveMessages(locale)).toBe(en)
  })

  it('keeps the Japanese and English catalogues structurally identical', () => {
    expect(nestedKeys(ja)).toEqual(nestedKeys(en))
  })
})
