import { useEffect, useRef } from 'react'
import type { MediaItem } from '../../api/queries.ts'
import { MediaGrid } from './MediaGrid.tsx'
import { UploadDropzone } from './UploadDropzone.tsx'

export function MediaPicker({
  open,
  onSelect,
  onClose,
}: {
  open: boolean
  onSelect: (item: MediaItem) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      className="m-auto h-[min(52rem,calc(100%-2rem))] w-[min(72rem,calc(100%-2rem))] border border-neutral-300 bg-white p-0 backdrop:bg-black/35"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-semibold">メディアを選択</h2>
        <button type="button" onClick={onClose} className="text-sm underline">
          閉じる
        </button>
      </div>
      {/* Mount the library only while open so closed pickers fetch nothing. */}
      {open && (
        <div className="space-y-6 p-4 sm:p-6">
          <UploadDropzone />
          <MediaGrid onSelect={onSelect} />
        </div>
      )}
    </dialog>
  )
}
