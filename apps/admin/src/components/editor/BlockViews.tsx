import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { useId, useState } from 'react'
import { FormPicker } from '../forms/FormPicker.tsx'

export function ImageView({ node, updateAttributes }: NodeViewProps) {
  const id = useId()
  return (
    <NodeViewWrapper className="editor-image-block" contentEditable={false}>
      <img
        src={node.attrs.src}
        alt={node.attrs.alt ?? ''}
        title={node.attrs.title ?? undefined}
        width={node.attrs.width ?? undefined}
        height={node.attrs.height ?? undefined}
        data-drag-handle
      />
      <details className="editor-node-controls">
        <summary>代替テキストを編集</summary>
        <label htmlFor={id}>代替テキスト</label>
        <input
          id={id}
          value={node.attrs.alt ?? ''}
          onChange={(event) => updateAttributes({ alt: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229)
              event.preventDefault()
          }}
        />
      </details>
    </NodeViewWrapper>
  )
}

export function HtmlView({ node, updateAttributes }: NodeViewProps) {
  const id = useId()
  return (
    <NodeViewWrapper contentEditable={false}>
      <details className="editor-node-controls">
        <summary>HTML ブロックを編集</summary>
        <label htmlFor={id}>HTML ソース</label>
        <textarea
          id={id}
          rows={5}
          spellCheck={false}
          value={node.attrs.html}
          onChange={(event) => updateAttributes({ html: event.target.value })}
        />
      </details>
    </NodeViewWrapper>
  )
}

export function FormView({ node, updateAttributes }: NodeViewProps) {
  const [open, setOpen] = useState(false)
  return (
    <NodeViewWrapper className="editor-node-controls editor-form-controls" contentEditable={false}>
      <span className="editor-form-block">{`フォーム: ${node.attrs.slug}`}</span>
      <button type="button" onClick={() => setOpen(true)}>
        フォームを変更
      </button>
      <FormPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(slug) => {
          updateAttributes({ slug })
          setOpen(false)
        }}
      />
    </NodeViewWrapper>
  )
}
