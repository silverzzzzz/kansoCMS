import { type RichTextDoc, richTextDocSchema } from '@kanso/shared'
import { useQueryClient } from '@tanstack/react-query'
import Image from '@tiptap/extension-image'
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useId, useRef, useState } from 'react'
import { ImageView } from './BlockViews.tsx'
import { isAllowedLink } from './commands.ts'
import { FormBlock } from './FormBlock.ts'
import { imageTransfers } from './image-transfer.ts'
import { LinkSelection } from './link-selection.ts'
import { RawHtml } from './RawHtml.ts'
import { Toolbar } from './Toolbar.tsx'
import './editor.css'

const SizedImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
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
  onUploadingChange,
  onInvalidChange,
}: {
  content: RichTextDoc
  onChange: (doc: RichTextDoc) => void
  onUploadingChange?: (pending: boolean) => void
  onInvalidChange?: (invalid: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const callbacks = useRef({ onUploadingChange, onInvalidChange })
  callbacks.current = { onUploadingChange, onInvalidChange }
  useEffect(
    () => () => {
      callbacks.current.onUploadingChange?.(false)
      callbacks.current.onInvalidChange?.(false)
    },
    [],
  )
  const queryClient = useQueryClient()
  const hint = useId()
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: { target: null, rel: null },
          isAllowedUri: (url) => isAllowedLink(url),
          shouldAutoLink: (url) => isAllowedLink(url),
        },
      }),
      SizedImage,
      LinkSelection,
      RawHtml,
      FormBlock,
      imageTransfers(
        setUploadError,
        (pending) => callbacks.current.onUploadingChange?.(pending),
        () => {
          void queryClient.invalidateQueries({ queryKey: ['media'] })
        },
      ),
    ],
    // Older empty documents may have no paragraphs. Seed the editable view
    // with its default paragraph without writing a change back on mount.
    content: content.content.length ? content : undefined,
    // The editable area is a textbox to assistive technology; it needs a name.
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': '本文',
        'aria-multiline': 'true',
        'aria-describedby': hint,
      },
    },
    onUpdate: ({ editor: current }) => {
      const parsed = richTextDocSchema.safeParse(current.getJSON())
      callbacks.current.onInvalidChange?.(!parsed.success)
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
    <div className="editor-frame">
      <Toolbar editor={editor} error={error ?? uploadError} />
      <EditorContent editor={editor} className="editor-content" />
      <p id={hint} className="editor-hint">
        空の段落で「/」または「／」を入力すると、見出しや画像を挿入できます。
      </p>
    </div>
  )
}
