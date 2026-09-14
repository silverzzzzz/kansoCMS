import { type RichTextDoc, richTextDocSchema } from '@kanso/shared'
import Image from '@tiptap/extension-image'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState } from 'react'
import { FormBlock } from './FormBlock.ts'
import { RawHtml } from './RawHtml.ts'
import { isAllowedLink, Toolbar } from './Toolbar.tsx'

const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const value = Number(element.getAttribute('width'))
          return Number.isInteger(value) && value > 0 ? value : null
        },
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const value = Number(element.getAttribute('height'))
          return Number.isInteger(value) && value > 0 ? value : null
        },
      },
    }
  },
})

/**
 * Uncontrolled after mount: `content` seeds the editor and every change is
 * reported through `onChange`. Mount with a `key` per record so switching
 * records re-creates the editor instead of syncing it (the zod-normalised doc
 * never matches `getJSON()` byte for byte, so syncing would reset the cursor).
 */
export function Editor({
  content,
  onChange,
}: {
  content: RichTextDoc
  onChange: (doc: RichTextDoc) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          isAllowedUri: (url) => isAllowedLink(url),
          shouldAutoLink: (url) => isAllowedLink(url),
        },
      }),
      SizedImage,
      RawHtml,
      FormBlock,
    ],
    content,
    onUpdate: ({ editor: current }) => {
      const parsed = richTextDocSchema.safeParse(current.getJSON())
      if (!parsed.success) {
        setError('エディタの内容を保存できない形式です')
        return
      }
      setError(null)
      onChange(parsed.data)
    },
  })

  if (!editor) return <div className="border border-neutral-300 p-4 text-sm">読み込み中…</div>

  return (
    <div className="border border-neutral-300 bg-white">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="editor-content" />
      {error && (
        <p
          role="alert"
          className="border-t border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  )
}
