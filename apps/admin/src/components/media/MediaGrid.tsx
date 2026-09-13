import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { api } from '../../api/client.ts'
import { ApiError } from '../../api/errors.ts'
import { type MediaItem, mediaListQuery } from '../../api/queries.ts'
import { unwrap } from '../../api/request.ts'
import { ConfirmDialog } from '../ConfirmDialog.tsx'
import { Pagination } from '../Pagination.tsx'
import { Alert, Button, EmptyState, inputClass } from '../ui.tsx'

export function MediaGrid({ onSelect }: { onSelect?: (item: MediaItem) => void }) {
  const searchId = useId()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [alt, setAlt] = useState('')
  const [deleting, setDeleting] = useState<MediaItem | null>(null)
  const media = useQuery(
    mediaListQuery({ page: String(page), perPage: '40', q: search || undefined }),
  )
  const saveAlt = useMutation({
    mutationFn: ({ item, value }: { item: MediaItem; value: string }) =>
      unwrap(
        api.media[':id'].$patch({
          param: { id: String(item.id) },
          json: { alt: value.trim() || null },
        }),
      ),
    onSuccess: async () => {
      setEditing(null)
      await queryClient.invalidateQueries({ queryKey: ['media'] })
    },
  })
  const remove = useMutation({
    mutationFn: (item: MediaItem) =>
      unwrap(api.media[':id'].$delete({ param: { id: String(item.id) } })),
    onSuccess: async () => {
      setDeleting(null)
      await queryClient.invalidateQueries({ queryKey: ['media'] })
    },
  })
  const error = saveAlt.error ?? remove.error ?? media.error

  return (
    <div>
      <form
        className="mb-5 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          setSearch(query.trim())
        }}
      >
        <label className="sr-only" htmlFor={searchId}>
          メディアを検索
        </label>
        <input
          id={searchId}
          className={`${inputClass} mt-0 max-w-md`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ファイル名で検索"
        />
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>
      {error && (
        <div className="mb-4">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : '処理に失敗しました'}
          </Alert>
        </div>
      )}
      {media.isLoading && <p className="text-sm text-neutral-600">読み込み中…</p>}
      {media.data?.items.length === 0 && <EmptyState>メディアはありません。</EmptyState>}
      <div className="grid gap-px border border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-4">
        {media.data?.items.map((item) => (
          <article key={item.id} className="bg-white p-3">
            <button
              type="button"
              className="block aspect-video w-full overflow-hidden bg-neutral-100 text-left outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              onClick={() => onSelect?.(item)}
              disabled={!onSelect}
            >
              {item.mime.startsWith('image/') ? (
                <img className="h-full w-full object-contain" src={item.url} alt={item.alt ?? ''} />
              ) : (
                <span className="flex h-full items-center justify-center p-3 text-xs text-neutral-600">
                  {item.filename}
                </span>
              )}
            </button>
            <p className="mt-3 truncate text-sm font-medium" title={item.filename}>
              {item.filename}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {item.width && item.height ? `${item.width}×${item.height}` : item.mime}
            </p>
            {editing === item.id ? (
              <form
                className="mt-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveAlt.mutate({ item, value: alt })
                }}
              >
                <label className="text-xs font-medium">
                  代替テキスト
                  <input
                    className={`${inputClass} mt-1`}
                    value={alt}
                    onChange={(event) => setAlt(event.target.value)}
                  />
                </label>
                <div className="mt-2 flex gap-1">
                  <Button type="submit" size="small" disabled={saveAlt.isPending}>
                    保存
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    onClick={() => setEditing(null)}
                  >
                    取消
                  </Button>
                </div>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1">
                {onSelect && (
                  <Button type="button" size="small" onClick={() => onSelect(item)}>
                    選択
                  </Button>
                )}
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={() => {
                    setEditing(item.id)
                    setAlt(item.alt ?? '')
                  }}
                >
                  alt 編集
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      new URL(item.url, window.location.origin).href,
                    )
                  }
                >
                  URL コピー
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="danger"
                  onClick={() => setDeleting(item)}
                >
                  削除
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
      {media.data && (
        <Pagination page={page} perPage={40} total={media.data.total} onChange={setPage} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="メディアを削除"
        description={`${deleting?.filename ?? ''} を削除します。この操作は取り消せません。`}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  )
}
