import { mergeAttributes, Node, ReactNodeViewRenderer } from '@tiptap/react'
import { HtmlView } from './BlockViews.tsx'

export const RawHtml = Node.create({
  name: 'rawHtml',
  group: 'block',
  atom: true,
  addNodeView() {
    return ReactNodeViewRenderer(HtmlView)
  },
  addAttributes() {
    return { html: { default: '' } }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-raw-html]',
        getAttrs: (element) => ({ html: element.getAttribute('data-raw-html') ?? '' }),
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    const { html, ...attributes } = HTMLAttributes
    return [
      'div',
      mergeAttributes(attributes, {
        'data-raw-html': html,
        class: 'editor-raw-html',
      }),
      'HTML ブロック',
    ]
  },
})
