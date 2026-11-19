import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { unwrap } from '../api/request.ts'
import { formatDateTime } from '../lib/datetime.ts'
import { Alert, Button, EmptyState } from './ui.tsx'

const backupsQueryKey = ['backups'] as const

// One string: JSX would drop the spaces at the line breaks the formatter chooses.
const DESCRIPTION =
  '毎日 1 回 (日本時間 3 時)、エクスポートと同じ JSON をサイト設定込みで保存し、新しい 7 件を残します。' +
  '戻すときはダウンロードして、下の「インポート」で取り込みます。' +
  '画像ファイル・ユーザー・API キー・フォームの送信データは含まれません (データベース全体は Cloudflare D1 の Time Travel で戻せます)。'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The daily backups in R2 (administrators only). A backup is the same JSON as
 * the export, with site settings; restoring is the import below.
 */
export function BackupList() {
  const queryClient = useQueryClient()
  const backups = useQuery({
    queryKey: backupsQueryKey,
    queryFn: () => unwrap(api.backups.$get()),
  })
  const create = useMutation({
    mutationFn: () => unwrap(api.backups.$post()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupsQueryKey }),
  })
  const error = create.error ?? backups.error
  const items = backups.data?.items ?? []

  return (
    <section className="mt-8 border border-neutral-200 bg-white p-5">
      <h2 className="text-lg font-semibold">バックアップ</h2>
      <p className="mt-1 text-sm text-neutral-600">{DESCRIPTION}</p>
      {error && (
        <div className="mt-4">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : 'バックアップを処理できませんでした'}
          </Alert>
        </div>
      )}
      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState>まだバックアップはありません。</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-200 border border-neutral-200">
            {items.map((item) => (
              <li key={item.name} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="font-medium">{formatDateTime(item.uploadedAt)}</span>
                <span className="text-neutral-500">{formatSize(item.size)}</span>
                <a
                  className="ml-auto underline"
                  href={`/api/v1/backups/${item.name}`}
                  download={item.name}
                >
                  ダウンロード
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4">
        <Button
          type="button"
          variant="secondary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? '保存中…' : '今すぐバックアップ'}
        </Button>
      </div>
    </section>
  )
}
