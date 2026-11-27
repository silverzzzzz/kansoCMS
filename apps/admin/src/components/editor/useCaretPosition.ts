import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { Editor } from '@tiptap/react'
import { useLayoutEffect, useRef } from 'react'
import { linkSelection } from './link-selection.ts'

/** A text caret is a virtual anchor: its coordinates can change on typing as well as scrolling. */
export function useCaretPosition<T extends HTMLElement>(editor: Editor, visible = true) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const panel = ref.current
    if (!panel || !visible) return
    const view = editor.view
    const toolbar = view.dom.closest('.editor-frame')?.querySelector('.editor-sticky-tools')
    const anchor = {
      contextElement: view.dom,
      getBoundingClientRect() {
        const selection = linkSelection.getState(view.state) ?? view.state.selection
        const { left, top, right, bottom } = view.coordsAtPos(selection.head)
        return new DOMRect(left, top, right - left, bottom - top)
      },
    }
    let revision = 0
    function update() {
      if (!panel || editor.isDestroyed) return
      const current = ++revision
      const padding = {
        top: Math.max(8, (toolbar?.getBoundingClientRect().bottom ?? 0) + 6),
        right: 8,
        bottom: 8,
        left: 8,
      }
      void computePosition(anchor, panel, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(6), flip({ padding }), shift({ padding })],
      }).then(({ x, y }) => {
        if (current !== revision) return
        panel.style.left = `${x}px`
        panel.style.top = `${y}px`
      })
    }
    const stop = autoUpdate(anchor, panel, update)
    editor.on('transaction', update)
    return () => {
      revision++
      stop()
      editor.off('transaction', update)
    }
  }, [editor, visible])
  return ref
}
