import { ApiError } from '../../api/errors.ts'
import { Alert, Button } from '../ui.tsx'

/** True when a save was refused because the item was saved elsewhere after it was loaded. */
export function isStaleError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'stale'
}

/**
 * Shown instead of the generic error when the API answered 409 `stale`: the
 * editor chooses between reloading (dropping their edits) and overwriting.
 */
export function StaleSaveNotice({
  what,
  pending,
  onReload,
  onOverwrite,
}: {
  what: string
  pending: boolean
  onReload: () => void
  onOverwrite: () => void
}) {
  return (
    <Alert tone="error">
      <p>
        この{what}
        は、この画面を開いたあとに別の画面で保存されています。このまま保存すると、その変更を上書きします。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="small"
          disabled={pending}
          onClick={onReload}
        >
          最新の内容を読み込む (この画面の変更は破棄)
        </Button>
        <Button type="button" size="small" disabled={pending} onClick={onOverwrite}>
          このまま上書き保存
        </Button>
      </div>
    </Alert>
  )
}
