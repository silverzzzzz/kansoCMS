import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'
import type { MediaItem } from '../../api/queries.ts'
import { mediaFileError, uploadMediaFile } from '../../lib/upload-media.ts'

export function imageContent(item: MediaItem) {
  return {
    type: 'image',
    attrs: { src: item.url, alt: item.alt ?? '', width: item.width, height: item.height },
  }
}

// Upload positions follow edits through ProseMirror's mapping. Deleting the
// host paragraph removes its placeholder, so a late response cannot revive it.
const uploads = new PluginKey<DecorationSet>('editor-image-uploads')

export function imageTransfers(
  onError: (message: string | null) => void,
  onPending: (pending: boolean) => void,
  onUploaded: () => void,
) {
  return Extension.create({
    name: 'imageTransfers',
    addProseMirrorPlugins() {
      const editor = this.editor
      let pending = 0
      async function upload(view: EditorView, files: File[], position: number, end = position) {
        const original = view.state.doc.slice(position, end)
        const marker = Decoration.widget(
          position,
          () => {
            const span = document.createElement('span')
            span.textContent = '画像をアップロード中…'
            span.className = 'editor-upload-marker'
            return span
          },
          { key: crypto.randomUUID(), side: -1 },
        )
        view.dispatch(view.state.tr.setMeta(uploads, { add: marker }))
        pending++
        onPending(true)
        onError(null)
        const images = []
        const errors: string[] = []
        try {
          for (const file of files) {
            const invalid =
              mediaFileError(file) ?? (!file.type.startsWith('image/') && '画像を選択してください')
            if (invalid) {
              errors.push(`${file.name}: ${invalid}`)
              continue
            }
            try {
              images.push(imageContent(await uploadMediaFile(file)))
            } catch (error) {
              errors.push(
                `${file.name}: ${error instanceof Error ? error.message : 'アップロードできませんでした'}`,
              )
            }
            if (view.isDestroyed || !view.dom.isConnected) break
          }
          if (images.length > 0) onUploaded()
          if (view.isDestroyed || !view.dom.isConnected) return
          const [anchor] =
            uploads
              .getState(view.state)
              ?.find(undefined, undefined, (spec) => spec.key === marker.spec.key) ?? []
          if (anchor) {
            view.dispatch(view.state.tr.setMeta(uploads, { remove: anchor }))
            if (images.length) {
              // Replace a pasted-over selection only if it still contains
              // exactly what was selected when the upload started.
              const to = Math.min(anchor.from + end - position, view.state.doc.content.size)
              const replaceTo = view.state.doc.slice(anchor.from, to).eq(original)
                ? to
                : anchor.from
              editor.commands.insertContentAt({ from: anchor.from, to: replaceTo }, images, {
                updateSelection: false,
              })
            }
          }
          if (errors.length) onError(errors.join(' ／ '))
        } finally {
          pending--
          if (!view.isDestroyed && view.dom.isConnected) onPending(pending > 0)
        }
      }
      return [
        new Plugin<DecorationSet>({
          key: uploads,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, previous) {
              const mapped = previous.map(tr.mapping, tr.doc)
              const change = tr.getMeta(uploads)
              if (change?.add) return mapped.add(tr.doc, [change.add])
              if (change?.remove) return mapped.remove([change.remove])
              return mapped
            },
          },
          props: {
            decorations: (state) => uploads.getState(state),
            handlePaste(view, event) {
              const files = Array.from(event.clipboardData?.files ?? [])
              if (!files.length) return false
              void upload(view, files, view.state.selection.from, view.state.selection.to)
              return true
            },
            handleDrop(view, event, _slice, moved) {
              const files = Array.from(event.dataTransfer?.files ?? [])
              if (moved || !files.length) return false
              const target = view.posAtCoords({ left: event.clientX, top: event.clientY })
              void upload(view, files, target?.pos ?? view.state.selection.from)
              return true
            },
          },
        }),
      ]
    },
  })
}
