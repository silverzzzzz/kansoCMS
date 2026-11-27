import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { Button } from '../ui.tsx'
import type { EditorSave } from './useEditorSave.ts'

type SaveBarState = Pick<EditorSave, 'formRef' | 'pending' | 'dirty' | 'saved' | 'error'> &
  Partial<
    Pick<
      EditorSave,
      'canSubmit' | 'unavailable' | 'hasDraft' | 'staleDraft' | 'restoreDraft' | 'dismissDraft'
    >
  >

/** Place directly inside the form so its sticky boundary includes the whole editor. */
export function SaveBar({
  save,
  label = '保存',
  disabled = false,
  error,
}: {
  save: SaveBarState
  label?: string
  disabled?: boolean
  error?: ReactNode
}) {
  const bar = useRef<HTMLDivElement>(null)
  const alert = useRef<HTMLDivElement>(null)
  const { formRef } = save
  useLayoutEffect(() => {
    const element = bar.current
    const form = element?.closest('form')
    if (!form || !element) return
    const update = () => {
      const offset = Number.parseFloat(getComputedStyle(element).top) + element.offsetHeight
      form.style.setProperty('--editor-toolbar-offset', `${offset}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => {
      observer.disconnect()
      form.style.removeProperty('--editor-toolbar-offset')
    }
  }, [])

  useEffect(() => {
    if (!save.error) return
    const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (field) {
      let details = field.closest('details')
      while (details) {
        details.open = true
        details = details.parentElement?.closest('details') ?? null
      }
      field.focus({ preventScroll: true })
      field.scrollIntoView({ block: 'center' })
    } else {
      alert.current?.focus({ preventScroll: true })
    }
  }, [formRef, save.error])

  const message =
    error ||
    (save.error ? '保存できませんでした。入力内容を確認して、もう一度保存してください。' : null)
  let status = ''
  if (save.pending) status = '保存中…'
  else if (save.dirty) status = '未保存の変更があります'
  else if (save.saved) status = '保存しました'

  return (
    <div
      ref={bar}
      className="sticky top-[calc(4rem+1px)] z-20 border-y border-neutral-200 bg-white px-3 py-1.5 sm:px-4"
    >
      <div className="flex min-h-11 items-center justify-between gap-2">
        <p role="status" className="text-sm font-medium text-neutral-700">
          {status}
        </p>
        <Button
          type="submit"
          className="min-h-11 shrink-0"
          disabled={save.pending || disabled || save.canSubmit === false}
        >
          {label}
        </Button>
      </div>
      {message && (
        <div ref={alert} role="alert" tabIndex={-1} className="mt-1 py-1 text-sm text-red-800">
          {message}
        </div>
      )}
      {save.unavailable && (
        <p role="status" className="py-1 text-sm text-neutral-700">
          この端末に下書きを保存できません。画面を閉じる前に保存してください。
        </p>
      )}
      {save.hasDraft && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-200 py-1">
          <p className="text-sm text-neutral-700">
            {save.staleDraft
              ? 'この端末の下書きは、現在の保存内容より前のものです。復元後に内容を確認してください。'
              : 'この端末に未保存の下書きがあります。'}
          </p>
          <Button
            variant="secondary"
            type="button"
            size="small"
            disabled={save.pending}
            onClick={save.restoreDraft}
          >
            下書きを復元
          </Button>
          <Button
            variant="secondary"
            type="button"
            size="small"
            disabled={save.pending}
            onClick={save.dismissDraft}
          >
            下書きを破棄
          </Button>
        </div>
      )}
    </div>
  )
}
