import { useBlocker } from '@tanstack/react-router'
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type BrowserDraft, useBrowserDraft } from './useBrowserDraft.ts'

export type EditorSave = {
  formRef: RefObject<HTMLFormElement | null>
  dirty: boolean
  pending: boolean
  canSubmit: boolean
  saved: boolean
  error: unknown
  submit: (overwrite?: boolean) => Promise<void>
  discard: () => void
  hasDraft: boolean
  staleDraft: boolean
  unavailable: boolean
  restoreDraft: () => void
  dismissDraft: () => void
}

type RegisteredForm = {
  formRef: EditorSave['formRef']
  needsGuard: () => boolean
}

const forms = new Set<RegisteredForm>()
const leaveMessage = '未保存の変更があります。この画面を離れますか？'

/** Check before an action such as logout destroys the editing session. */
export function confirmEditorLeave(message = leaveMessage) {
  return !Array.from(forms).some((entry) => entry.needsGuard()) || window.confirm(message)
}

function saveShortcut(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.key.toLowerCase() !== 's' ||
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.shiftKey
  )
    return
  const target = event.target instanceof Element ? event.target : null
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return
  const registered = Array.from(forms).filter((entry) => {
    const form = entry.formRef.current
    return form?.isConnected && !form.closest('[inert], [hidden]')
  })
  const focused = target?.closest('form')
  if (!focused && target?.closest('input, textarea, select, [contenteditable="true"]')) return
  const owner = focused
    ? registered.find((entry) => entry.formRef.current === focused)
    : (registered.find((entry) => entry.needsGuard()) ?? registered[0])
  if (!owner) return
  event.preventDefault()
  if (event.repeat || event.isComposing || event.keyCode === 229) return
  const form = owner.formRef.current
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (button && !button.matches(':disabled')) form?.requestSubmit(button)
}

/** Standalone editors can share the navigation, reload and logout guard. */
export function useEditorLeaveGuard(isDirty: boolean, form?: RegisteredForm) {
  const dirty = useRef(isDirty)
  const formRef = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => {
    dirty.current = isDirty
  }, [isDirty])
  const [standalone] = useState<RegisteredForm>(() => ({
    formRef,
    needsGuard: () => dirty.current,
  }))
  const entry = form ?? standalone
  useEffect(() => {
    forms.add(entry)
    window.addEventListener('keydown', saveShortcut)
    return () => {
      forms.delete(entry)
      if (!forms.size) window.removeEventListener('keydown', saveShortcut)
    }
  }, [entry])
  const shouldBlockFn = useCallback(() => {
    // Settings, for example, has multiple independently saved forms on one route.
    const firstDirty = Array.from(forms).find((registered) => registered.needsGuard())
    return firstDirty === entry && !window.confirm(leaveMessage)
  }, [entry])
  useBlocker({ shouldBlockFn, enableBeforeUnload: entry.needsGuard, disabled: !isDirty })
  return entry.formRef
}

type SavedValue<T> = {
  value: T
  apply: () => void
  /** Adopt server-normalized fields that have not been edited since submit. */
  merge?: () => void
}
type AfterSave = () => void | Promise<void>

/** Mount with the loaded initial snapshot, keyed by account/resource. Values must be JSON-safe. */
export function useEditorSave<T>({
  value,
  onSave,
  draft,
  initialSaved = false,
  isNew = false,
}: {
  value: T
  // biome-ignore lint/suspicious/noConfusingVoidType: a save callback with no return value is valid.
  onSave: (snapshot: T, overwrite: boolean) => Promise<void | SavedValue<T> | AfterSave>
  draft?: BrowserDraft<T>
  initialSaved?: boolean
  isNew?: boolean
}): EditorSave {
  const formRef = useRef<HTMLFormElement>(null)
  const snapshot = useMemo(() => JSON.stringify(value), [value])
  const baseline = useRef(snapshot)
  const live = useRef(snapshot)
  const busy = useRef(false)
  const mounted = useRef(false)
  const [pending, setPending] = useState(false)
  const [lastSave, setLastSave] = useState({ snapshot, saved: initialSaved })
  const [error, setError] = useState<unknown>(null)
  const dirty = snapshot !== lastSave.snapshot
  const canSubmit = !pending && (dirty || (isNew && !lastSave.saved))
  const { clearOwned, ...backup } = useBrowserDraft(draft, value, dirty)

  useLayoutEffect(() => {
    live.current = snapshot
  }, [snapshot])

  const [entry] = useState<RegisteredForm>(() => ({
    formRef,
    needsGuard: () => busy.current || live.current !== baseline.current,
  }))
  useEditorLeaveGuard(dirty || pending, entry)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function submit(overwrite = false) {
    if (busy.current || formRef.current?.closest('[inert]')) return
    if (snapshot === baseline.current && (!isNew || lastSave.saved)) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await onSave(value, overwrite)
      baseline.current = snapshot
      const unchanged = live.current === snapshot
      if (unchanged) {
        clearOwned()
        if (result && typeof result !== 'function' && mounted.current) {
          baseline.current = JSON.stringify(result.value)
          live.current = baseline.current
          result.apply()
        }
      } else if (result && typeof result !== 'function' && result.merge && mounted.current) {
        baseline.current = JSON.stringify(result.value)
        result.merge()
      }
      busy.current = false
      if (mounted.current) {
        setLastSave({ snapshot: baseline.current, saved: true })
        if (typeof result === 'function') await result()
      }
    } catch (cause) {
      if (mounted.current) setError(cause)
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }

  function discard() {
    baseline.current = live.current
    clearOwned()
    setLastSave({ snapshot: baseline.current, saved: false })
    setError(null)
  }

  return {
    formRef,
    dirty,
    pending,
    canSubmit,
    saved: lastSave.saved && !error,
    error,
    submit,
    discard,
    ...backup,
  }
}
