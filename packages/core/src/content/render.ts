import type { RichTextDoc, RichTextMark, RichTextNode } from '@kanso/shared'
import { KansoError } from '../errors.ts'
import { escapeAttr, escapeHtml } from './html.ts'

export interface RenderOptions {
  allowRawHtml: boolean
}

const LANGUAGE_PATTERN = /^[a-z0-9_+-]{1,32}$/

function allowedHref(href: string): boolean {
  return href.startsWith('/') || href.startsWith('#') || /^(https?:|mailto:|tel:)/i.test(href)
}

function allowedImageSrc(src: string): boolean {
  return src.startsWith('/media/') || /^https?:/i.test(src)
}

function mergeRel(rel: string | null | undefined, target: '_blank' | null | undefined): string {
  const values = rel?.split(/\s+/).filter(Boolean) ?? []
  if (target === '_blank') {
    if (!values.includes('noopener')) values.push('noopener')
    if (!values.includes('noreferrer')) values.push('noreferrer')
  }
  return values.join(' ')
}

function renderMark(content: string, mark: RichTextMark): string {
  switch (mark.type) {
    case 'bold':
      return `<strong>${content}</strong>`
    case 'italic':
      return `<em>${content}</em>`
    case 'underline':
      return `<u>${content}</u>`
    case 'strike':
      return `<s>${content}</s>`
    case 'code':
      return `<code>${content}</code>`
    case 'link': {
      if (!allowedHref(mark.attrs.href)) return content

      const attributes = [`href="${escapeAttr(mark.attrs.href)}"`]
      if (mark.attrs.target === '_blank') attributes.push('target="_blank"')
      const rel = mergeRel(mark.attrs.rel, mark.attrs.target)
      if (rel) attributes.push(`rel="${escapeAttr(rel)}"`)
      if (mark.attrs.title) attributes.push(`title="${escapeAttr(mark.attrs.title)}"`)
      return `<a ${attributes.join(' ')}>${content}</a>`
    }
  }
}

function renderText(node: Extract<RichTextNode, { type: 'text' }>): string {
  const text = escapeHtml(node.text)
  return (node.marks ?? []).reduceRight(renderMark, text)
}

function renderImage(node: Extract<RichTextNode, { type: 'image' }>): string {
  if (!allowedImageSrc(node.attrs.src)) return ''

  const attributes = [
    `src="${escapeAttr(node.attrs.src)}"`,
    `alt="${escapeAttr(node.attrs.alt ?? '')}"`,
  ]
  if (node.attrs.title) attributes.push(`title="${escapeAttr(node.attrs.title)}"`)
  if (node.attrs.width !== undefined && node.attrs.width !== null) {
    attributes.push(`width="${escapeAttr(String(node.attrs.width))}"`)
  }
  if (node.attrs.height !== undefined && node.attrs.height !== null) {
    attributes.push(`height="${escapeAttr(String(node.attrs.height))}"`)
  }
  attributes.push('loading="lazy"')
  return `<img ${attributes.join(' ')}>`
}

function renderContent(content: RichTextNode[] | undefined, options: RenderOptions): string {
  return content?.map((node) => renderNode(node, options)).join('') ?? ''
}

function renderNode(node: RichTextNode, options: RenderOptions): string {
  switch (node.type) {
    case 'text':
      return renderText(node)
    case 'hardBreak':
      return '<br>'
    case 'paragraph': {
      const textAlign = node.attrs?.textAlign
      const style = textAlign ? ` style="text-align:${textAlign}"` : ''
      return `<p${style}>${renderContent(node.content, options)}</p>`
    }
    case 'heading':
      return `<h${node.attrs.level}>${renderContent(node.content, options)}</h${node.attrs.level}>`
    case 'bulletList':
      return `<ul>${renderContent(node.content, options)}</ul>`
    case 'orderedList': {
      const start = node.attrs?.start
      const attribute = start === undefined ? '' : ` start="${escapeAttr(String(start))}"`
      return `<ol${attribute}>${renderContent(node.content, options)}</ol>`
    }
    case 'listItem':
      return `<li>${renderContent(node.content, options)}</li>`
    case 'blockquote':
      return `<blockquote>${renderContent(node.content, options)}</blockquote>`
    case 'codeBlock': {
      const language = node.attrs?.language
      const className =
        language && LANGUAGE_PATTERN.test(language) ? ` class="language-${language}"` : ''
      const code = node.content?.map((child) => escapeHtml(child.text)).join('') ?? ''
      return `<pre><code${className}>${code}</code></pre>`
    }
    case 'horizontalRule':
      return '<hr>'
    case 'image':
      return renderImage(node)
    case 'form':
      return `<div data-kanso-form="${escapeAttr(node.attrs.slug)}"></div>`
    case 'rawHtml':
      if (!options.allowRawHtml) {
        throw KansoError.forbidden('Raw HTML blocks are not allowed')
      }
      return node.attrs.html
  }
}

export function renderRichText(doc: RichTextDoc, options: RenderOptions): string {
  return renderContent(doc.content, options)
}
