import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { formsListQuery } from '../../api/queries.ts'
import { Alert } from '../ui.tsx'

export function FormPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (slug: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const forms = useQuery({ ...formsListQuery, enabled: open })

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
      className="m-auto w-[min(32rem,calc(100%-2rem))] border border-neutral-300 bg-white p-0 backdrop:bg-black/35"
    >
      <div className="flex items-center justify-between border-b border-neutral-200 p-4">
        <h2 className="text-lg font-semibold">フォームを選択</h2>
        <button type="button" onClick={onClose} className="text-sm underline">
          閉じる
        </button>
      </div>
      {open && (
        <div className="p-4 sm:p-6">
          {forms.error && <Alert tone="error">フォームの読み込みに失敗しました。</Alert>}
          {forms.isLoading && <p className="text-sm text-neutral-600">読み込み中…</p>}
          {forms.data?.items.length === 0 && (
            <p className="text-sm text-neutral-600">
              フォームがありません。{' '}
              <Link to="/forms/new" className="underline">
                新規作成
              </Link>
            </p>
          )}
          <div className="grid gap-px border border-neutral-200 bg-neutral-200">
            {forms.data?.items.map((form) => (
              <button
                key={form.id}
                type="button"
                className="bg-white p-3 text-left outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950"
                onClick={() => onSelect(form.slug)}
              >
                <span className="block text-sm font-medium text-neutral-900">{form.name}</span>
                <span className="mt-1 block text-xs text-neutral-500">{form.slug}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </dialog>
  )
}
