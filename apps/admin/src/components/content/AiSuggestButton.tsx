import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { aiStatusQuery } from '../../api/queries.ts'
import { Button } from '../ui.tsx'

/**
 * "AI で生成" — runs `request` and hands the suggested text to `onResult`.
 * Failures surface a small message and never touch existing form values.
 * Renders nothing while the optional AI binding is not configured.
 */
export function AiSuggestButton({
  request,
  disabled = false,
  onResult,
}: {
  /** Calls the suggestion endpoint (see `lib/ai.ts`). */
  request: () => Promise<{ text: string }>
  /** No source material yet, e.g. an empty body. */
  disabled?: boolean
  onResult: (text: string) => void
}) {
  const status = useQuery(aiStatusQuery)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = async () => {
    setPending(true)
    setFailed(false)
    try {
      const result = await request()
      onResult(result.text)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  if (!status.data?.available) return null

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="small"
        variant="secondary"
        disabled={pending || disabled}
        onClick={run}
      >
        {pending ? '生成中…' : 'AI で生成'}
      </Button>
      {failed && <span className="text-xs text-red-700">生成できませんでした</span>}
    </span>
  )
}
