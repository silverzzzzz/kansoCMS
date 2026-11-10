import type { RichTextDoc, RichTextNode } from './richtext.ts'

export interface TocItem {
  /** Anchor id shared with `injectHeadingIds` (`h-1`, `h-2`, …). */
  id: string
  level: number
  text: string
}

/**
 * h2/h3 collected from a rich-text document in document order. Ids are a
 * positional `h-N` counter — language-neutral and stable as long as the
 * heading order does not change.
 */
export function extractToc(doc: RichTextDoc | null | undefined): TocItem[] {
  const items: TocItem[] = []
  let n = 0
  const walk = (nodes: RichTextNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === 'heading' && (node.attrs.level === 2 || node.attrs.level === 3)) {
        n += 1
        const text = nodeText(node)
        if (text) items.push({ id: `h-${n}`, level: node.attrs.level, text })
      }
      // Headings are top-level in practice, but nested blocks stay supported.
      if ('content' in node) walk(node.content)
    }
  }
  walk(doc?.content)
  return items
}

function nodeText(node: RichTextNode): string {
  if (node.type === 'text') return node.text
  if ('content' in node && Array.isArray(node.content)) {
    return node.content.map(nodeText).join('')
  }
  return ''
}

/**
 * Adds `id="h-N"` to every `<h2>`/`<h3>` open tag in rendered body HTML, in
 * document order — the same numbering `extractToc` produces. The rich-text
 * renderer emits bare heading tags, so plain open-tag matching is safe and
 * also covers bodyHtml stored before ids existed.
 */
export function injectHeadingIds(html: string): string {
  let n = 0
  return html.replace(/<h([23])>/g, (_match, level) => {
    n += 1
    return `<h${level} id="h-${n}">`
  })
}
