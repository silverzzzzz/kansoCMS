import type { RichTextDoc } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import { docHasText, seoChecks, serpModel, truncateMiddle } from './seo-check.ts'

const doc = (content: unknown[]): RichTextDoc => ({ type: 'doc', content }) as RichTextDoc

describe('docHasText', () => {
  it('returns false for an empty doc', () => {
    expect(docHasText(doc([]))).toBe(false)
    expect(docHasText({ type: 'doc' } as RichTextDoc)).toBe(false)
  })

  it('finds nested text', () => {
    expect(
      docHasText(doc([{ type: 'paragraph', content: [{ type: 'text', text: 'こんにちは' }] }])),
    ).toBe(true)
    expect(docHasText(doc([{ type: 'paragraph', content: [{ type: 'text', text: '  ' }] }]))).toBe(
      false,
    )
  })
})

describe('seoChecks', () => {
  const base = {
    title: '十分な長さのページタイトルです',
    slug: 'about',
    description: 'a'.repeat(80),
    hasOg: false,
    hasSiteOg: false,
    hasBody: true,
  }

  it('marks all items ok when everything is in range', () => {
    const checks = seoChecks({ ...base, hasOg: true })
    expect(checks.every((check) => check.status === 'ok')).toBe(true)
  })

  it('warns on short titles and missing description', () => {
    const checks = seoChecks({ ...base, title: '短い', description: '' })
    expect(checks[0]?.status).toBe('warn')
    expect(checks[1]?.status).toBe('warn')
    expect(checks[1]?.detail).toContain('自動生成')
  })

  it('accepts the site-wide OG image as a fallback', () => {
    const checks = seoChecks({ ...base, hasSiteOg: true })
    const og = checks.find((check) => check.label === 'OG 画像')
    expect(og?.status).toBe('ok')
    expect(og?.detail).toContain('サイト既定')
  })
})

describe('serpModel', () => {
  it('builds a breadcrumb from host and path segments', () => {
    const model = serpModel({
      siteName: 'My Site',
      origin: 'https://example.com/',
      publicPath: '/blog/hello-world',
      title: 'Hello',
      description: 'World',
    })
    expect(model.breadcrumb).toBe('example.com › blog › hello-world')
    expect(model.siteName).toBe('My Site')
  })

  it('falls back to the host and placeholders', () => {
    const model = serpModel({
      siteName: '',
      origin: 'https://example.com',
      publicPath: '/',
      title: ' ',
      description: '',
    })
    expect(model.siteName).toBe('example.com')
    expect(model.breadcrumb).toBe('example.com')
    expect(model.title).toBe('(タイトル未設定)')
  })
})

describe('truncateMiddle', () => {
  it('truncates long strings with an ellipsis', () => {
    expect(truncateMiddle('abcdefghij', 5)).toBe('abcd…')
    expect(truncateMiddle('abc', 5)).toBe('abc')
  })
})
