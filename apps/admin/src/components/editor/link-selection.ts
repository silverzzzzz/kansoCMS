import { Plugin, PluginKey, type Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { type Editor, Extension } from '@tiptap/react'

export const linkSelection = new PluginKey<Selection | null>('link-selection')

/** Keep the link's target while focus is in the URL field, including across pending image uploads. */
export const LinkSelection = Extension.create({
  name: 'linkSelection',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkSelection,
        state: {
          init: () => null,
          apply(tr, previous: Selection | null) {
            const editing = tr.getMeta(linkSelection)
            if (editing === true) return tr.selection
            if (editing === false) return null
            return previous && tr.docChanged ? previous.map(tr.doc, tr.mapping) : previous
          },
        },
        props: {
          decorations(state) {
            const selected = linkSelection.getState(state)
            if (!selected || selected.empty) return null
            return DecorationSet.create(state.doc, [
              Decoration.inline(selected.from, selected.to, { class: 'editor-link-selection' }),
            ])
          },
        },
      }),
    ]
  },
})

export function selectLinkTarget(editor: Editor) {
  const { view } = editor
  let target = view.state.selection
  const selection = view.dom.ownerDocument.getSelection()
  // A keyboard shortcut can arrive before the browser fires selectionchange.
  if (
    view.hasFocus() &&
    target instanceof TextSelection &&
    selection?.anchorNode &&
    selection.focusNode &&
    view.dom.contains(selection.anchorNode) &&
    view.dom.contains(selection.focusNode)
  ) {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset)
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset)
    target = TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head))
  }
  const chain = editor.chain().command(({ tr }) => {
    tr.setSelection(target)
    return true
  })
  if (target.empty) chain.extendMarkRange('link')
  chain.setMeta(linkSelection, true).scrollIntoView().run()
}
