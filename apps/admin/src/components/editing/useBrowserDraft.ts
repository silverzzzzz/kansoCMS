import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type BrowserDraft<T> = {
  userId: number
  resource: string
  /** Version from which the form was seeded, advanced after a successful save. */
  version: string
  parse: (value: unknown) => T | null
  restore: (value: T, version: string) => void
}

type StoredDraft<T> = { key: string; raw: string; value: T; version: string; time: number }

function removeCopy(record: Pick<StoredDraft<unknown>, 'key' | 'raw'> | null) {
  if (record && localStorage.getItem(record.key) === record.raw) localStorage.removeItem(record.key)
}

function readLatest<T>(prefix: string, parse: BrowserDraft<T>['parse'], ownKey?: string) {
  let latest: StoredDraft<T> | null = null
  try {
    const storage = window.localStorage
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (!key?.startsWith(prefix) || key === ownKey) continue
      const raw = storage.getItem(key)
      if (!raw) continue
      try {
        const data = JSON.parse(raw)
        if (typeof data?.version !== 'string' || !Number.isFinite(data.time)) continue
        const value = parse(data.value)
        if (value !== null && (!latest || data.time > latest.time)) {
          latest = { key, raw, value, version: data.version, time: data.time }
        }
      } catch {
        // A malformed copy must not keep the other copies from being recoverable.
      }
    }
  } catch {
    // Storage is optional. Report a write failure if the user starts editing.
  }
  return latest
}

export function useBrowserDraft<T>(draft: BrowserDraft<T> | undefined, value: T, dirty: boolean) {
  const prefix = draft && `kanso:draft:v1:${draft.userId}:${encodeURIComponent(draft.resource)}:`
  // Each mounted editor owns its own slot. A second tab cannot overwrite its work.
  // The form's owner keys the component by resource, just as for its initial values.
  const [key] = useState(() => prefix && prefix + crypto.randomUUID())
  const [candidate, setCandidate] = useState(() =>
    draft && prefix ? readLatest(prefix, draft.parse) : null,
  )
  const [unavailable, setUnavailable] = useState(false)
  const adopted = useRef<StoredDraft<T> | null>(null)
  const queued = useRef<(() => void) | null>(null)
  const wrote = useRef(false)

  const clearOwned = useCallback(() => {
    queued.current = null
    try {
      if (key && wrote.current) localStorage.removeItem(key)
      removeCopy(adopted.current)
      adopted.current = null
      wrote.current = false
      setUnavailable(false)
    } catch {
      setUnavailable(true)
    }
  }, [key])

  const version = draft?.version
  // Keep synchronous storage writes off the typing path. Flush the last edit on exit.
  useLayoutEffect(() => {
    if (!key || version === undefined) return
    if (!dirty) {
      clearOwned()
      return
    }
    const write = () => {
      try {
        localStorage.setItem(key, JSON.stringify({ version, time: Date.now(), value }))
        wrote.current = true
        removeCopy(adopted.current)
        adopted.current = null
        queued.current = null
        setUnavailable(false)
      } catch {
        setUnavailable(true)
      }
    }
    queued.current = write
    const timer = window.setTimeout(() => queued.current?.(), 350)
    return () => window.clearTimeout(timer)
  }, [key, value, dirty, version, clearOwned])

  useEffect(() => {
    if (!key) return
    const flush = () => queued.current?.()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [key])

  function dismissDraft() {
    if (!candidate) return
    try {
      removeCopy(candidate)
      setCandidate(draft && prefix ? readLatest(prefix, draft.parse, key) : null)
    } catch {
      setUnavailable(true)
    }
  }

  const staleDraft = !!candidate && candidate.version !== version
  function restoreDraft() {
    if (!candidate || !draft) return
    if (dirty && !window.confirm('入力中の内容を、この端末の下書きに置き換えますか？')) return
    adopted.current = candidate
    setCandidate(null)
    draft.restore(candidate.value, candidate.version)
  }

  return {
    hasDraft: !!candidate,
    staleDraft,
    unavailable,
    restoreDraft,
    dismissDraft,
    clearOwned,
  }
}
