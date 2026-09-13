import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { pagesListQuery } from '../../../api/queries.ts'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Button, EmptyState, inputClass } from '../../../components/ui.tsx'
import { flattenPageTree } from '../../../lib/page-tree.ts'

const initialParams = { perPage: '100' }

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
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const pages = useQuery(pagesListQuery({ perPage: '100', q: search || undefined }))
  const rows = search
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
      <form
        className="my-6 flex gap-2"
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
          className={`${inputClass} mt-0 max-w-md`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="タイトルで検索"
        />
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState>固定ページはありません。</EmptyState>
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
                  <td className="px-4 py-3">{page.status === 'published' ? '公開' : '下書き'}</td>
                  <td className="px-4 py-3 text-neutral-600">{formatDate(page.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
