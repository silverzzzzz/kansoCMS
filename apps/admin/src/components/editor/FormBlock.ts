import { mergeAttributes, Node } from '@tiptap/react'

export const FormBlock = Node.create({
  name: 'form',
  group: 'block',
  atom: true,
  addAttributes() {
    return { slug: { default: '' } }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-kanso-form]',
        getAttrs: (element) => ({ slug: element.getAttribute('data-kanso-form') ?? '' }),
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    const { slug, ...attributes } = HTMLAttributes
    return [
      'div',
      mergeAttributes(attributes, {
        'data-kanso-form': slug,
        class: 'editor-form-block',
      }),
      `フォーム: ${slug}`,
    ]
  },
})
