import { useEffect, useRef } from 'react'
import { Button } from './ui.tsx'

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '削除',
  pending = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  pending?: boolean
  onConfirm: () => void
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
      className="m-auto w-[min(28rem,calc(100%-2rem))] border border-neutral-300 bg-white p-0 text-neutral-950 backdrop:bg-black/35"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm underline" aria-label="閉じる">
            閉じる
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-neutral-600">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? '処理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
