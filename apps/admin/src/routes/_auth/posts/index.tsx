import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { postsListQuery, postTypesQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Pagination } from '../../../components/Pagination.tsx'
import { Alert, Button, EmptyState, inputClass } from '../../../components/ui.tsx'
import { isScheduled } from '../../../lib/schedule.ts'

type PostSearch = {
  type?: string
  page?: number
  q?: string
  status?: 'draft' | 'published' | 'scheduled'
  trashed?: boolean
}

type TrashedPost = {
  id: number
  title: string
  slug: string
  deletedAt: string | null
}

export const Route = createFileRoute('/_auth/posts/')({
  validateSearch: (search: Record<string, unknown>): PostSearch => ({
    type: typeof search.type === 'string' ? search.type : undefined,
    page: typeof search.page === 'number' && search.page >= 1 ? Math.floor(search.page) : undefined,
    q: typeof search.q === 'string' && search.q.trim() ? search.q.trim() : undefined,
    status:
      search.status === 'draft' || search.status === 'published' || search.status === 'scheduled'
        ? search.status
        : undefined,
    trashed: search.trashed === true,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const types = await context.queryClient.ensureQueryData(postTypesQuery)
    const type = deps.type ?? types.items[0]?.slug
    if (type)
      await context.queryClient.ensureQueryData(
        postsListQuery({
          type,
          page: String(deps.page ?? 1),
          perPage: '20',
          q: deps.q,
          status: deps.status,
          trashed: deps.trashed ? 'true' : undefined,
        }),
      )
  },
  component: PostsPage,
})

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—'
}

function PostsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const types = useQuery(postTypesQuery)
  const type = search.type ?? types.data?.items[0]?.slug
  const page = search.page ?? 1
  const [query, setQuery] = useState(search.q ?? '')
  const [purging, setPurging] = useState<TrashedPost | null>(null)
  const posts = useQuery({
    ...postsListQuery({
      type,
      page: String(page),
      perPage: '20',
      q: search.q,
      status: search.status,
      trashed: search.trashed ? 'true' : undefined,
    }),
    enabled: Boolean(type),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['posts'] })
  const restore = useMutation({
    mutationFn: (id: number) =>
      unwrap(api.posts[':id'].restore.$post({ param: { id: String(id) } })),
    onSuccess: invalidate,
  })
  const purge = useMutation({
    mutationFn: () =>
      purging
        ? unwrap(
            api.posts[':id'].$delete({
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

  if (types.data?.items.length === 0)
    return (
      <div>
        <PageHeading title="投稿" />
        <div className="mt-6">
          <EmptyState>
            先に
            <Link to="/post-types/new" className="mx-1 font-medium underline">
              投稿タイプを作成してください
            </Link>
            。
          </EmptyState>
        </div>
      </div>
    )

  const updateSearch = (next: PostSearch) => void navigate({ search: next })
  return (
    <div>
      <PageHeading
        title="投稿"
        description="投稿タイプごとに記事を管理します。"
        actions={
          type && (
            <Link
              to="/posts/new"
              search={{ type }}
              className="border border-neutral-950 bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"
            >
              新規作成
            </Link>
          )
        }
      />
      <nav className="mt-6 flex flex-wrap border-b border-neutral-300" aria-label="投稿タイプ">
        {types.data?.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`border border-b-0 px-4 py-2 text-sm ${type === item.slug ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-300 bg-white'}`}
            onClick={() => updateSearch({ type: item.slug })}
          >
            {item.name}
          </button>
        ))}
      </nav>
      <nav className="mt-3 flex gap-4 text-sm" aria-label="表示切替">
        <button
          type="button"
          className={
            search.trashed ? 'text-neutral-500' : 'font-medium underline underline-offset-4'
          }
          onClick={() => updateSearch({ type })}
        >
          一覧
        </button>
        <button
          type="button"
          className={
            search.trashed ? 'font-medium underline underline-offset-4' : 'text-neutral-500'
          }
          onClick={() => updateSearch({ type, trashed: true })}
        >
          ゴミ箱
        </button>
      </nav>
      {mutationError && (
        <div className="mt-4">
          <Alert tone="error">
            {mutationError instanceof ApiError ? mutationError.message : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <form
        className={`my-6 grid gap-2 ${search.trashed ? 'sm:grid-cols-[1fr_auto]' : 'sm:grid-cols-[1fr_12rem_auto]'}`}
        onSubmit={(event) => {
          event.preventDefault()
          updateSearch({ ...search, type, page: 1, q: query.trim() || undefined })
        }}
      >
        <label className="sr-only" htmlFor="post-search">
          投稿を検索
        </label>
        <input
          id="post-search"
          className={`${inputClass} mt-0`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="タイトルで検索"
        />
        {!search.trashed && (
          <>
            <label className="sr-only" htmlFor="post-status">
              状態
            </label>
            <select
              id="post-status"
              className={`${inputClass} mt-0`}
              value={search.status ?? ''}
              onChange={(event) =>
                updateSearch({
                  ...search,
                  type,
                  page: 1,
                  status: event.target.value
                    ? (event.target.value as PostSearch['status'])
                    : undefined,
                })
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
      {posts.data?.items.length === 0 ? (
        <EmptyState>{search.trashed ? 'ゴミ箱は空です。' : '投稿はありません。'}</EmptyState>
      ) : search.trashed ? (
        <div className="overflow-x-auto border border-neutral-200 bg-white">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-4 py-3 font-medium">タイトル</th>
                <th className="px-4 py-3 font-medium">スラッグ</th>
                <th className="px-4 py-3 font-medium">削除日時</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {posts.data?.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium">{item.title}</td>
                  <td className="px-4 py-3 text-neutral-600">{item.slug}</td>
                  <td className="px-4 py-3 text-neutral-600">{formatDate(item.deletedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        disabled={restore.isPending}
                        onClick={() => restore.mutate(item.id)}
                      >
                        復元
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="danger"
                        onClick={() => setPurging(item)}
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
                <th className="px-4 py-3 font-medium">スラッグ</th>
                <th className="px-4 py-3 font-medium">状態</th>
                <th className="px-4 py-3 font-medium">公開日時</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {posts.data?.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <Link
                      to="/posts/$id"
                      params={{ id: String(item.id) }}
                      className="font-medium underline underline-offset-4"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{item.slug}</td>
                  <td className="px-4 py-3">
                    {item.status === 'published' ? (
                      isScheduled(item) ? (
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
                  <td className="px-4 py-3 text-neutral-600">{formatDate(item.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={purging !== null}
        title="投稿を完全に削除"
        description={`「${purging?.title ?? ''}」を完全に削除します。リビジョンも削除され、元に戻せません。`}
        confirmLabel="完全に削除"
        pending={purge.isPending}
        onClose={() => setPurging(null)}
        onConfirm={() => purge.mutate()}
      />
      {posts.data && (
        <Pagination
          page={page}
          perPage={20}
          total={posts.data.total}
          onChange={(next) => updateSearch({ ...search, type, page: next })}
        />
      )}
    </div>
  )
}
