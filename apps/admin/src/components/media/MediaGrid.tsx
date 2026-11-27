import { canSuggestAlt, mediaVariantUrl } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { api } from '../../api/client.ts'
import { ApiError } from '../../api/errors.ts'
import { type MediaItem, mediaListQuery } from '../../api/queries.ts'
import { unwrap } from '../../api/request.ts'
import { suggestAlt } from '../../lib/ai.ts'
import { backfillImageVariants, needsImageVariants } from '../../lib/image-variants.ts'
import { ConfirmDialog } from '../ConfirmDialog.tsx'
import { AiSuggestButton } from '../content/AiSuggestButton.tsx'
import { MoreActions } from '../MoreActions.tsx'
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
  const [optimizing, setOptimizing] = useState<string | null>(null)
  const pending = (media.data?.items ?? []).filter(needsImageVariants)
  // Images uploaded before variants existed (the sample site's included).
  const optimize = useMutation({
    mutationFn: async (items: MediaItem[]) => {
      let failed = 0
      for (const [index, item] of items.entries()) {
        setOptimizing(`${index + 1} / ${items.length}`)
        await backfillImageVariants(item).catch(() => {
          failed += 1
        })
      }
      if (failed > 0) throw new Error(`${failed} 件の縮小版を作成できませんでした`)
    },
    onSettled: async () => {
      setOptimizing(null)
      await queryClient.invalidateQueries({ queryKey: ['media'] })
    },
  })
  const error = saveAlt.error ?? remove.error ?? optimize.error ?? media.error

  return (
    <div>
      <form
        className="mb-5 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
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
            {error instanceof ApiError
              ? error.message
              : error === optimize.error
                ? error.message
                : '処理に失敗しました'}
          </Alert>
        </div>
      )}
      {!onSelect && pending.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 border border-neutral-200 bg-white px-4 py-3 text-sm">
          <p className="text-neutral-700">
            このページの画像のうち {pending.length} 件に、表示サイズに合わせた縮小版がありません。
          </p>
          <Button
            type="button"
            size="small"
            variant="secondary"
            disabled={optimize.isPending}
            onClick={() => optimize.mutate(pending)}
          >
            {optimize.isPending ? `作成中 ${optimizing ?? ''}` : '縮小版を作成'}
          </Button>
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
              aria-label={onSelect ? `${item.filename} を選択` : undefined}
              onClick={() => onSelect?.(item)}
              disabled={!onSelect}
            >
              {item.mime.startsWith('image/') ? (
                <img
                  className="h-full w-full object-contain"
                  src={mediaVariantUrl(item, 480)}
                  alt={item.alt ?? ''}
                  loading="lazy"
                />
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
              {item.variants.length > 0 && ` ・ 縮小版 ${item.variants.length} 種`}
            </p>
            {onSelect ? (
              <Button className="mt-3" type="button" size="small" onClick={() => onSelect(item)}>
                選択
              </Button>
            ) : editing === item.id ? (
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
                {canSuggestAlt(item) && (
                  <div className="mt-2">
                    <AiSuggestButton request={() => suggestAlt(item.id)} onResult={setAlt} />
                  </div>
                )}
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
              <div className="mt-3 flex justify-end">
                <MoreActions
                  label={`${item.filename} のその他の操作`}
                  actions={[
                    {
                      label: 'alt 編集',
                      run: () => {
                        setEditing(item.id)
                        setAlt(item.alt ?? '')
                      },
                    },
                    {
                      label: 'URL コピー',
                      run: () =>
                        void navigator.clipboard.writeText(
                          new URL(item.url, window.location.origin).href,
                        ),
                    },
                    { label: '削除', run: () => setDeleting(item) },
                  ]}
                />
              </div>
            )}
          </article>
        ))}
      </div>
      {media.data && (
        <Pagination page={page} perPage={40} total={media.data.total} onChange={setPage} />
      )}
      {!onSelect && (
        <ConfirmDialog
          open={deleting !== null}
          title="メディアを削除"
          description={`${deleting?.filename ?? ''} を削除します。この操作は取り消せません。`}
          pending={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => deleting && remove.mutate(deleting)}
        />
      )}
    </div>
  )
}
