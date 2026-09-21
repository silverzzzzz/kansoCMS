import type { RichTextDoc, RichTextNode } from '@kanso/shared'

export const EMPTY_DOCUMENT: RichTextDoc = { type: 'doc', content: [] }

function textFromNode(node: RichTextNode): string {
  switch (node.type) {
    case 'text':
      return node.text
    case 'hardBreak':
      return ' '
    case 'paragraph':
    case 'heading':
      return node.content?.map(textFromNode).join('') ?? ''
    case 'bulletList':
    case 'orderedList':
    case 'listItem':
    case 'blockquote':
      return node.content.map(textFromNode).join(' ')
    case 'codeBlock':
    case 'horizontalRule':
    case 'image':
    case 'form':
    case 'rawHtml':
      return ''
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

export function plainText(doc: RichTextDoc): string {
  return doc.content.map(textFromNode).join(' ').replace(/\s+/g, ' ').trim()
}

function excerptFromHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractExcerpt(input: RichTextDoc | string, maxLength = 160): string {
  const text = typeof input === 'string' ? excerptFromHtml(input) : plainText(input)
  return truncate(text, maxLength)
}

export function effectiveExcerpt(
  row: { excerpt: string | null; bodyJson: RichTextDoc | null },
  maxLength = 160,
): string {
  const storedExcerpt = row.excerpt?.trim()
  return storedExcerpt || extractExcerpt(row.bodyJson ?? EMPTY_DOCUMENT, maxLength)
}
