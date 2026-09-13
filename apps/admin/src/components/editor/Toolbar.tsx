import type { Editor } from '@tiptap/react'
import { useState } from 'react'
import { MediaPicker } from '../media/MediaPicker.tsx'

export function isAllowedLink(value: string): boolean {
  return /^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(value)
}

export function Toolbar({ editor }: { editor: Editor }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const buttonClass =
    'border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-800 ' +
    'outline-none hover:border-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-950 ' +
    'aria-pressed:border-neutral-950 aria-pressed:bg-neutral-950 aria-pressed:text-white'

  function setLink() {
    const current = editor.getAttributes('link').href
    const value = window.prompt('リンク先 URL', typeof current === 'string' ? current : '')
    if (value === null) return
    const href = value.trim()
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    if (!isAllowedLink(href)) {
      window.alert('リンクは /、#、http(s)、mailto、tel で始まる URL を指定してください')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  const action = (label: string, pressed: boolean, onClick: () => void, disabled = false) => (
    <button
      key={label}
      type="button"
      className={buttonClass}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )

  return (
    <>
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 bg-neutral-50 p-2">
        {action('段落', editor.isActive('paragraph'), () =>
          editor.chain().focus().setParagraph().run(),
        )}
        {[2, 3, 4].map((level) =>
          action(`H${level}`, editor.isActive('heading', { level }), () =>
            editor
              .chain()
              .focus()
              .toggleHeading({ level: level as 2 | 3 | 4 })
              .run(),
          ),
        )}
        {action('太字', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
        {action('斜体', editor.isActive('italic'), () =>
          editor.chain().focus().toggleItalic().run(),
        )}
        {action('下線', editor.isActive('underline'), () =>
          editor.chain().focus().toggleUnderline().run(),
        )}
        {action('打ち消し', editor.isActive('strike'), () =>
          editor.chain().focus().toggleStrike().run(),
        )}
        {action('コード', editor.isActive('code'), () => editor.chain().focus().toggleCode().run())}
        {action('リンク', editor.isActive('link'), setLink)}
        {action('箇条書き', editor.isActive('bulletList'), () =>
          editor.chain().focus().toggleBulletList().run(),
        )}
        {action('番号付き', editor.isActive('orderedList'), () =>
          editor.chain().focus().toggleOrderedList().run(),
        )}
        {action('引用', editor.isActive('blockquote'), () =>
          editor.chain().focus().toggleBlockquote().run(),
        )}
        {action('コードブロック', editor.isActive('codeBlock'), () =>
          editor.chain().focus().toggleCodeBlock().run(),
        )}
        {action('区切り線', false, () => editor.chain().focus().setHorizontalRule().run())}
        {action('画像', false, () => setPickerOpen(true))}
        {action('元に戻す', false, () => editor.chain().focus().undo().run(), !editor.can().undo())}
        {action('やり直す', false, () => editor.chain().focus().redo().run(), !editor.can().redo())}
      </div>
      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => {
          // Insert with the size in one go: after insertion the cursor sits past
          // the node, so a follow-up `updateAttributes('image')` would not reach it.
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'image',
              attrs: { src: item.url, alt: item.alt ?? '', width: item.width, height: item.height },
            })
            .run()
          setPickerOpen(false)
        }}
      />
    </>
  )
}
