import type { Editor } from '@tiptap/react'
import { useEffect, useId, useRef, useState } from 'react'
import { normalizeLink } from './commands.ts'
import { linkSelection } from './link-selection.ts'
import { useCaretPosition } from './useCaretPosition.ts'

export function LinkPanel({ editor, close }: { editor: Editor; close: () => void }) {
  const id = useId()
  const panel = useCaretPosition<HTMLFieldSetElement>(editor)
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(String(editor.getAttributes('link').href ?? ''))
  const [newTab, setNewTab] = useState(editor.getAttributes('link').target === '_blank')
  const [error, setError] = useState('')
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [close, panel])

  function cancel() {
    const target = linkSelection.getState(editor.state)
    if (target) editor.view.dispatch(editor.state.tr.setSelection(target))
    close()
    editor.view.focus()
  }
  function apply() {
    const href = normalizeLink(value)
    if (href === null) {
      setError(
        'example.com、/about、#見出し、または https://、http://、mailto:、tel: で始まるリンク先を入力してください。',
      )
      input.current?.focus()
      return
    }
    const attrs = { href, target: newTab ? '_blank' : null }
    const target = linkSelection.getState(editor.state)
    if (!target) return
    const chain = editor.chain().command(({ tr }) => {
      tr.setSelection(target)
      return true
    })
    if (!href) chain.unsetLink().run()
    else if (target.empty) {
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs }] }).run()
    } else chain.setLink(attrs).run()
    close()
    editor.view.focus()
  }

  return (
    <fieldset
      ref={panel}
      className="editor-link-panel"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close()
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        } else if (event.key === 'Enter' && event.target === input.current) {
          event.preventDefault()
          apply()
        }
      }}
    >
      <legend className="sr-only">リンクの編集</legend>
      <label htmlFor={id}>リンク先 URL</label>
      <div>
        <input
          id={id}
          ref={input}
          value={value}
          inputMode="url"
          autoComplete="off"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setError('')
          }}
        />
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={apply}>
          適用
        </button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={cancel}>
          閉じる
        </button>
      </div>
      <label className="editor-new-tab">
        <input
          type="checkbox"
          checked={newTab}
          onChange={(event) => setNewTab(event.target.checked)}
        />
        新しいタブで開く
      </label>
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}
