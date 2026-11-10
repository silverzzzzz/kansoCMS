import type { AiSuggestKind } from '@kanso/shared'
import { useState } from 'react'
import { suggestAi } from '../../lib/ai.ts'
import { Button } from '../ui.tsx'

/**
 * "AI で生成" — calls /api/v1/ai/suggest and hands the result to onResult.
 * Failures surface a small message and never touch existing form values.
 */
export function AiSuggestButton({
  kind,
  text,
  onResult,
}: {
  kind: AiSuggestKind
  /** Source material sent to the model; the button stays disabled while empty. */
  text: string
  onResult: (text: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = async () => {
    setPending(true)
    setFailed(false)
    try {
      const result = await suggestAi(kind, text)
      onResult(result.text)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="small"
        variant="secondary"
        disabled={pending || text.trim() === ''}
        onClick={run}
      >
        {pending ? '生成中…' : 'AI で生成'}
      </Button>
      {failed && <span className="text-xs text-red-700">生成できませんでした</span>}
    </span>
  )
}
