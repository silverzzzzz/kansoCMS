import type { ContentStatus } from '@kanso/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { postsListQuery, postTypesQuery } from '../../../api/queries.ts'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Pagination } from '../../../components/Pagination.tsx'
import { Button, EmptyState, inputClass } from '../../../components/ui.tsx'

type PostSearch = { type?: string; page?: number; q?: string; status?: ContentStatus }

export const Route = createFileRoute('/_auth/posts/')({
  validateSearch: (search: Record<string, unknown>): PostSearch => ({
    type: typeof search.type === 'string' ? search.type : undefined,
    page: typeof search.page === 'number' && search.page >= 1 ? Math.floor(search.page) : undefined,
    q: typeof search.q === 'string' && search.q.trim() ? search.q.trim() : undefined,
    status: search.status === 'draft' || search.status === 'published' ? search.status : undefined,
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
  const types = useQuery(postTypesQuery)
  const type = search.type ?? types.data?.items[0]?.slug
  const page = search.page ?? 1
  const [query, setQuery] = useState(search.q ?? '')
  const posts = useQuery({
    ...postsListQuery({
      type,
      page: String(page),
      perPage: '20',
      q: search.q,
      status: search.status,
    }),
    enabled: Boolean(type),
  })

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
      <form
        className="my-6 grid gap-2 sm:grid-cols-[1fr_12rem_auto]"
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
              status: event.target.value ? (event.target.value as ContentStatus) : undefined,
            })
          }
        >
          <option value="">すべての状態</option>
          <option value="draft">下書き</option>
          <option value="published">公開</option>
        </select>
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>
      {posts.data?.items.length === 0 ? (
        <EmptyState>投稿はありません。</EmptyState>
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
                  <td className="px-4 py-3">{item.status === 'published' ? '公開' : '下書き'}</td>
                  <td className="px-4 py-3 text-neutral-600">{formatDate(item.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
