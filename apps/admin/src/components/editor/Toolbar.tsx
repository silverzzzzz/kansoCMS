import { type Editor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react'
import { FormPicker } from '../forms/FormPicker.tsx'
import { MediaPicker } from '../media/MediaPicker.tsx'
import { commands, type EditorCommand, type EditorPanel } from './commands.ts'
import { imageContent } from './image-transfer.ts'
import { LinkPanel } from './LinkPanel.tsx'
import { linkSelection, selectLinkTarget } from './link-selection.ts'
import { SlashMenu } from './SlashMenu.tsx'

const styles = commands.filter((command) => command.group === 'style')
const insertions = commands.filter((command) => command.group === 'insert')
const buttons = commands.filter(
  (command) => command.group !== 'style' && command.group !== 'insert',
)

export function Toolbar({ editor, error }: { editor: Editor; error: string | null }) {
  const [panel, setPanel] = useState<EditorPanel | null>(null)
  const [tabStop, setTabStop] = useState('bold')
  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      Object.fromEntries(
        commands.map((command) => [
          command.id,
          { pressed: command.active?.(editor), enabled: command.enabled?.(editor) ?? true },
        ]),
      ),
  })
  const style = styles.find((command) => state[command.id]?.pressed)?.id ?? ''

  const closeLink = useCallback(() => {
    editor.commands.setMeta(linkSelection, false)
    setPanel(null)
  }, [editor])
  const openPanel = useCallback(
    (next: EditorPanel) => {
      if (next === 'link') selectLinkTarget(editor)
      setPanel(next)
    },
    [editor],
  )
  useEffect(() => {
    const dom = editor.view.dom
    function shortcut(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        editor.view.composing ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k' ||
        event.target !== dom
      )
        return
      event.preventDefault()
      openPanel('link')
    }
    dom.addEventListener('keydown', shortcut)
    return () => dom.removeEventListener('keydown', shortcut)
  }, [editor, openPanel])
  function run(command: EditorCommand) {
    command.run(editor, openPanel)
  }
  function commandButton(command: EditorCommand, inToolbar: boolean) {
    const title = command.shortcut ? `${command.label} (${command.shortcut})` : command.label
    return (
      <button
        key={command.id}
        type="button"
        aria-label={command.label}
        title={title}
        aria-pressed={state[command.id]?.pressed}
        aria-disabled={!state[command.id]?.enabled || undefined}
        tabIndex={inToolbar && command.id !== tabStop ? -1 : 0}
        onFocus={inToolbar ? () => setTabStop(command.id) : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (state[command.id]?.enabled) run(command)
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={command.icon} />
        </svg>
      </button>
    )
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLButtonElement)) return
    const controls = Array.from(event.currentTarget.querySelectorAll('button'))
    const index = controls.indexOf(event.target)
    const destinations: Record<string, number> = {
      Home: 0,
      End: controls.length - 1,
      ArrowRight: (index + 1) % controls.length,
      ArrowLeft: (index + controls.length - 1) % controls.length,
    }
    const next = destinations[event.key]
    if (next !== undefined) {
      event.preventDefault()
      controls[next]?.focus()
    }
  }

  return (
    <>
      <div className="editor-sticky-tools">
        <div
          className="editor-tool-scroll editor-tool-buttons"
          role="toolbar"
          aria-label="本文の編集"
          onKeyDown={moveFocus}
        >
          <select
            aria-label="段落の種類"
            value={style}
            onChange={(event) => {
              const selected = styles.find((command) => command.id === event.target.value)
              if (selected) run(selected)
            }}
          >
            {!style && <option value="">書式</option>}
            {styles.map((command) => (
              <option key={command.id} value={command.id}>
                {command.label}
              </option>
            ))}
          </select>
          <select
            aria-label="挿入"
            className="editor-insert-select"
            value=""
            onChange={(event) => {
              const command = insertions.find((entry) => entry.id === event.target.value)
              if (command) run(command)
            }}
          >
            <option value="" disabled>
              ＋ 挿入
            </option>
            {insertions.map((command) => (
              <option key={command.id} value={command.id}>
                {command.label}
              </option>
            ))}
          </select>
          {buttons.map((command) => commandButton(command, true))}
        </div>
        {error && (
          <p
            role="alert"
            className="border-t border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
      </div>
      {panel === 'link' && <LinkPanel editor={editor} close={closeLink} />}
      {!panel && <SlashMenu editor={editor} run={run} />}
      <BubbleMenu
        editor={editor}
        className="editor-selection-menu"
        updateDelay={80}
        shouldShow={({ view, state, from, to }) =>
          view.hasFocus() &&
          !view.composing &&
          from !== to &&
          !!state.doc.textBetween(from, to).trim()
        }
      >
        <fieldset aria-label="選択した文字の書式" className="editor-tool-buttons">
          {commands
            .filter((command) => command.group === 'inline')
            .map((command) => commandButton(command, false))}
        </fieldset>
      </BubbleMenu>
      <MediaPicker
        open={panel === 'image'}
        onClose={() => setPanel(null)}
        onSelect={(item) => {
          editor.chain().focus().insertContent(imageContent(item)).run()
          setPanel(null)
        }}
      />
      <FormPicker
        open={panel === 'form'}
        onClose={() => setPanel(null)}
        onSelect={(slug) => {
          editor.chain().focus().insertContent({ type: 'form', attrs: { slug } }).run()
          setPanel(null)
        }}
      />
    </>
  )
}
