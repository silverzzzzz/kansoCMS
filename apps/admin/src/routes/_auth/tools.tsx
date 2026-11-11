import { exportBundleSchema, type ImportReport, splitBundle } from '@kanso/shared'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { api } from '../../api/client.ts'
import { ApiError } from '../../api/errors.ts'
import { unwrap } from '../../api/request.ts'
import { PageHeading } from '../../components/PageHeading.tsx'
import { Alert, Button, Field } from '../../components/ui.tsx'

export const Route = createFileRoute('/_auth/tools')({
  component: ToolsPage,
})

type Progress = { done: number; total: number }

function emptyReport(): ImportReport {
  return { created: 0, updated: 0, skipped: 0, warnings: [] }
}

function addReport(total: ImportReport, part: ImportReport): ImportReport {
  return {
    created: total.created + part.created,
    updated: total.updated + part.updated,
    skipped: total.skipped + part.skipped,
    warnings: [...total.warnings, ...part.warnings],
  }
}

/** Content portability (T57): JSON export download and slug-upsert import. */
function ToolsPage() {
  const { user } = Route.useRouteContext()
  const isAdmin = user.role === 'admin'
  const fileRef = useRef<HTMLInputElement>(null)
  const [includeSettings, setIncludeSettings] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)

  const exportBundle = useMutation({
    mutationFn: async () => {
      const data = await unwrap(
        api.export.$get({ query: isAdmin && includeSettings ? { settings: '1' as const } : {} }),
      )
      const day = new Date().toISOString().slice(0, 10)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `kanso-export-${day}.json`
      link.click()
      URL.revokeObjectURL(url)
    },
  })

  /**
   * A file is imported as a series of requests (structure, then pages, then
   * posts, then settings), each small enough for one Worker invocation. The
   * import is an upsert, so a run that stops halfway can simply be repeated.
   */
  const importBundle = useMutation({
    mutationFn: async (file: File) => {
      let raw: unknown
      try {
        raw = JSON.parse(await file.text())
      } catch {
        throw new ApiError(0, 'validation', 'JSON ファイルを読み取れませんでした')
      }
      const parsed = exportBundleSchema.safeParse(raw)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw new ApiError(
          0,
          'validation',
          `エクスポートファイルの形式が正しくありません (${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''})`,
        )
      }
      const parts = splitBundle(parsed.data)
      let total = emptyReport()
      setProgress({ done: 0, total: parts.length })
      for (const [index, part] of parts.entries()) {
        const { media: _media, ...body } = part
        total = addReport(total, await unwrap(api.import.$post({ json: body })))
        setReport(total)
        setProgress({ done: index + 1, total: parts.length })
      }
      return total
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = ''
    },
    onSettled: () => setProgress(null),
  })

  const error = exportBundle.error ?? importBundle.error

  return (
    <div>
      <PageHeading
        title="ツール"
        description="コンテンツ一式のエクスポート / インポート (JSON)。"
      />
      {error && (
        <div className="mt-6">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : '処理できませんでした'}
            {importBundle.error && report && (
              <span className="mt-1 block">
                途中まで取り込み済みです。同じファイルでもう一度実行すると続きから取り込めます。
              </span>
            )}
          </Alert>
        </div>
      )}

      <section className="mt-8 border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold">エクスポート</h2>
        <p className="mt-1 text-sm text-neutral-600">
          投稿タイプ・カテゴリ・タグ・固定ページ・投稿・リダイレクト・メニュー・フォームの定義を
          JSON でダウンロードします。メディアの実ファイル (R2)
          とフォームの送信データは含まれません。
        </p>
        {isAdmin && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSettings}
              onChange={(event) => setIncludeSettings(event.target.checked)}
            />
            サイト設定も含める
          </label>
        )}
        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={exportBundle.isPending}
            onClick={() => exportBundle.mutate()}
          >
            {exportBundle.isPending ? 'エクスポート中…' : 'JSON をダウンロード'}
          </Button>
        </div>
      </section>

      <section className="mt-8 border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold">インポート</h2>
        <p className="mt-1 text-sm text-neutral-600">
          エクスポートした JSON を取り込みます。同じスラッグ / パスのコンテンツは上書きされ、2
          回実行しても差分は出ません。このサイトにないメディアへの参照は外され、警告に出ます。
          大きなファイルは自動で分割して送ります。
          {!isAdmin && ' サイト設定は管理者だけが取り込めます。'}
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            const file = fileRef.current?.files?.[0]
            setImportError(null)
            setReport(null)
            if (!file) {
              setImportError('ファイルを選択してください')
              return
            }
            importBundle.mutate(file)
          }}
        >
          <Field label="エクスポート JSON">
            <input
              ref={fileRef}
              className="mt-1 block text-sm"
              type="file"
              accept="application/json,.json"
              required
            />
          </Field>
          <div className="flex items-center justify-end gap-3">
            {progress && (
              <span className="text-sm text-neutral-600">
                {progress.done} / {progress.total}
              </span>
            )}
            <Button type="submit" disabled={importBundle.isPending}>
              {importBundle.isPending ? 'インポート中…' : 'インポート'}
            </Button>
          </div>
        </form>
        {importError && (
          <div className="mt-4">
            <Alert tone="error">{importError}</Alert>
          </div>
        )}
        {report && (
          <div className="mt-4 space-y-2">
            <Alert tone="success">
              新規 {report.created} 件・更新 {report.updated} 件・スキップ {report.skipped} 件
            </Alert>
            {report.warnings.length > 0 && (
              <Alert tone="error">
                警告:
                <ul className="mt-1 list-inside list-disc">
                  {report.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
