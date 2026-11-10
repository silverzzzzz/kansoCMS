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

type ImportReport = {
  created: number
  updated: number
  skipped: number
  warnings: string[]
}

/** Content portability (T57): JSON export download and slug-upsert import. */
function ToolsPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [includeSettings, setIncludeSettings] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)

  const exportBundle = useMutation({
    mutationFn: async () => {
      const data = await unwrap(
        api.export.$get({ query: includeSettings ? { settings: '1' as const } : {} }),
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

  const importBundle = useMutation({
    mutationFn: async (file: File) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new ApiError(0, 'validation', 'JSON ファイルを読み取れませんでした')
      }
      return unwrap(api.import.$post({ json: parsed as never }))
    },
    onSuccess: (result) => {
      setReport(result)
      if (fileRef.current) fileRef.current.value = ''
    },
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
            {error instanceof ApiError && error.status !== 0
              ? error.message
              : (importError ?? '処理できませんでした')}
          </Alert>
        </div>
      )}

      <section className="mt-8 border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold">エクスポート</h2>
        <p className="mt-1 text-sm text-neutral-600">
          投稿タイプ・タクソノミー・固定ページ・投稿・メディア (メタのみ) ・リダイレクト・メニューを
          JSON でダウンロードします。メディアの実ファイル (R2) は含まれません。
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeSettings}
            onChange={(event) => setIncludeSettings(event.target.checked)}
          />
          サイト設定も含める
        </label>
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
          エクスポート JSON をアップロードします。同じスラッグ / パスのコンテンツは上書き (upsert)
          され、2 回実行しても差分は出ません。メディア行が無い参照は null になり警告に出ます。
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
            <input ref={fileRef} type="file" accept="application/json,.json" required />
          </Field>
          <div className="flex justify-end">
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
