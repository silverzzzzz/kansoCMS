import { type Editor, useEditorState } from '@tiptap/react'
import { useEffect, useId, useState } from 'react'
import { commands, type EditorCommand } from './commands.ts'
import { useCaretPosition } from './useCaretPosition.ts'

const insertCommands = commands.filter((command) =>
  ['insert', 'block', 'style'].includes(command.group),
)

function slashRange(editor: Editor) {
  const { empty, $from } = editor.state.selection
  if (!editor.isFocused || !empty || $from.parent.type.name !== 'paragraph') return null
  const text = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC')
  if (!/^[/／][^\s/／]*$/u.test(text)) return null
  return {
    from: $from.start(),
    to: $from.pos,
    query: text.slice(1).normalize('NFKC').toLowerCase(),
  }
}

/** Keep the caret in the document so normal typing, IME and Escape all preserve literal text. */
export function SlashMenu({
  editor,
  run,
}: {
  editor: Editor
  run: (command: EditorCommand) => void
}) {
  const id = useId()
  const range = useEditorState({ editor, selector: ({ editor }) => slashRange(editor) })
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const [composing, setComposing] = useState(false)
  const matches = range
    ? insertCommands.filter(
        (command) =>
          command.id.toLowerCase().includes(range.query) || command.label.includes(range.query),
      )
    : []
  const index = Math.min(active, matches.length - 1)
  const visible = !!range && dismissed !== range.from && !composing && matches.length > 0
  const menu = useCaretPosition<HTMLDivElement>(editor, visible)

  useEffect(() => {
    const dom = editor.view.dom
    const start = () => setComposing(true)
    const end = () => setComposing(false)
    dom.addEventListener('compositionstart', start)
    dom.addEventListener('compositionend', end)
    return () => {
      dom.removeEventListener('compositionstart', start)
      dom.removeEventListener('compositionend', end)
    }
  }, [editor])

  useEffect(() => {
    if (!range) {
      setDismissed(null)
      setActive(0)
    }
  }, [range])

  function choose(command: EditorCommand) {
    const current = slashRange(editor)
    if (
      !current ||
      current.from !== range?.from ||
      current.query !== range.query ||
      editor.view.composing
    )
      return
    const trigger = { from: current.from, to: current.to }
    // Picker insertion replaces this selection. Cancel leaves the typed text intact.
    if (command.opensPicker) editor.commands.setTextSelection(trigger)
    else editor.commands.deleteRange(trigger)
    run(command)
  }

  useEffect(() => {
    if (!range || !visible) return
    const dom = editor.view.dom
    dom.setAttribute('aria-controls', id)
    dom.setAttribute('aria-activedescendant', `${id}-${index}`)
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || editor.view.composing) {
        // Leave conversion to the browser, including Safari's final Enter.
        // ProseMirror's paragraph shortcut must not consume that same event.
        if (event.key === 'Enter') event.stopImmediatePropagation()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      switch (event.key) {
        case 'ArrowDown':
          setActive((index + 1) % matches.length)
          break
        case 'ArrowUp':
          setActive((index + matches.length - 1) % matches.length)
          break
        case 'Escape':
          setDismissed(range.from)
          break
        case 'Enter': {
          const command = matches[index]
          if (command) choose(command)
          break
        }
        default:
          return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    dom.addEventListener('keydown', handleKey, true)
    return () => {
      dom.removeEventListener('keydown', handleKey, true)
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  })

  useEffect(() => {
    if (!visible) return
    const option = document.getElementById(`${id}-${index}`)
    const list = option?.parentElement
    if (!option || !list) return
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight
  }, [id, index, visible])

  if (!visible) return null
  return (
    <div ref={menu} id={id} role="listbox" aria-label="本文への挿入" className="editor-slash-menu">
      {matches.map((command, position) => (
        <button
          key={command.id}
          id={`${id}-${position}`}
          type="button"
          role="option"
          aria-selected={index === position}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(command)}
        >
          {command.label}
        </button>
      ))}
    </div>
  )
}
