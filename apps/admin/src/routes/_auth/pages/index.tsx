import { TRASH_RETENTION_DAYS } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { pagesListQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, EmptyState, inputClass } from '../../../components/ui.tsx'
import { flattenPageTree } from '../../../lib/page-tree.ts'
import { isScheduled } from '../../../lib/schedule.ts'

const initialParams = { perPage: '100' }

type TrashedPage = {
  id: number
  title: string
  path: string
  deletedAt: string | null
}

export const Route = createFileRoute('/_auth/pages/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(pagesListQuery(initialParams)),
  component: PagesPage,
})

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—'
}

function PagesPage() {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | 'draft' | 'published' | 'scheduled'>('')
  const [trashed, setTrashed] = useState(false)
  const [purging, setPurging] = useState<TrashedPage | null>(null)
  const pages = useQuery(
    pagesListQuery({
      perPage: '100',
      q: search || undefined,
      status: trashed ? undefined : status || undefined,
      trashed: trashed ? 'true' : undefined,
    }),
  )
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pages'] })
  const restore = useMutation({
    mutationFn: (id: number) =>
      unwrap(api.pages[':id'].restore.$post({ param: { id: String(id) } })),
    onSuccess: invalidate,
  })
  const purge = useMutation({
    mutationFn: () =>
      purging
        ? unwrap(
            api.pages[':id'].$delete({
              param: { id: String(purging.id) },
              query: { force: 'true' },
            }),
          )
        : Promise.reject(new Error('削除対象がありません')),
    onSuccess: async () => {
      setPurging(null)
      await invalidate()
    },
  })
  const mutationError = restore.error ?? purge.error

  const rows =
    search || status || trashed
      ? (pages.data?.items ?? []).map((page) => ({ page, depth: 0 }))
      : flattenPageTree(pages.data?.items ?? [])

  return (
    <div>
      <PageHeading
        title="固定ページ"
        description="サイトの固定コンテンツを階層で管理します。"
        actions={
          <Link
            to="/pages/new"
            className="border border-neutral-950 bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"
          >
            新規作成
          </Link>
        }
      />
      <nav className="mt-6 flex gap-4 text-sm" aria-label="表示切替">
        <button
          type="button"
          className={trashed ? 'text-neutral-500' : 'font-medium underline underline-offset-4'}
          onClick={() => setTrashed(false)}
        >
          一覧
        </button>
        <button
          type="button"
          className={trashed ? 'font-medium underline underline-offset-4' : 'text-neutral-500'}
          onClick={() => setTrashed(true)}
        >
          ゴミ箱
        </button>
      </nav>
      {trashed && (
        <p className="mt-3 text-xs text-neutral-500">
          ゴミ箱に入れてから {TRASH_RETENTION_DAYS} 日たつと、自動で完全に削除されます。
        </p>
      )}
      {mutationError && (
        <div className="mt-4">
          <Alert tone="error">
            {mutationError instanceof ApiError ? mutationError.message : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <form
        className={`my-6 grid gap-2 ${trashed ? 'sm:grid-cols-[minmax(0,1fr)_auto]' : 'sm:grid-cols-[minmax(0,1fr)_12rem_auto]'}`}
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(input.trim())
        }}
      >
        <label className="sr-only" htmlFor="page-search">
          固定ページを検索
        </label>
        <input
          id="page-search"
          className={`${inputClass} mt-0! min-w-0`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="タイトルで検索"
        />
        {!trashed && (
          <>
            <label className="sr-only" htmlFor="page-status">
              状態
            </label>
            <select
              id="page-status"
              className={`${inputClass} mt-0!`}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as '' | 'draft' | 'published' | 'scheduled')
              }
            >
              <option value="">すべての状態</option>
              <option value="draft">下書き</option>
              <option value="published">公開</option>
              <option value="scheduled">予約</option>
            </select>
          </>
        )}
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState>{trashed ? 'ゴミ箱は空です。' : '固定ページはありません。'}</EmptyState>
      ) : trashed ? (
        <div className="overflow-x-auto border border-neutral-200 bg-white">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-4 py-3 font-medium">タイトル</th>
                <th className="px-4 py-3 font-medium">パス</th>
                <th className="px-4 py-3 font-medium">削除日時</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rows.map(({ page }) => (
                <tr key={page.id}>
                  <td className="px-4 py-3 font-medium">{page.title}</td>
                  <td className="px-4 py-3 text-neutral-600">/{page.path}</td>
                  <td className="px-4 py-3 text-neutral-600">{formatDate(page.deletedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        disabled={restore.isPending}
                        onClick={() => restore.mutate(page.id)}
                      >
                        復元
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="danger"
                        onClick={() => setPurging(page)}
                      >
                        完全に削除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto border border-neutral-200 bg-white">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-4 py-3 font-medium">タイトル</th>
                <th className="px-4 py-3 font-medium">パス</th>
                <th className="px-4 py-3 font-medium">状態</th>
                <th className="px-4 py-3 font-medium">更新日時</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rows.map(({ page, depth }) => (
                <tr key={page.id}>
                  <td className="px-4 py-3">
                    <Link
                      to="/pages/$id"
                      params={{ id: String(page.id) }}
                      className="font-medium underline underline-offset-4"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                    >
                      {page.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">/{page.path}</td>
                  <td className="px-4 py-3">
                    {page.status === 'published' ? (
                      isScheduled(page) ? (
                        <span className="border border-neutral-950 px-1.5 py-0.5 text-xs font-medium">
                          予約
                        </span>
                      ) : (
                        '公開'
                      )
                    ) : (
                      '下書き'
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{formatDate(page.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={purging !== null}
        title="固定ページを完全に削除"
        description={`「${purging?.title ?? ''}」を完全に削除します。リビジョンも削除され、元に戻せません。`}
        confirmLabel="完全に削除"
        pending={purge.isPending}
        onClose={() => setPurging(null)}
        onConfirm={() => purge.mutate()}
      />
    </div>
  )
}
