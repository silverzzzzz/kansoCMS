import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { postTypesQuery } from '../../../api/queries.ts'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { EmptyState } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/post-types/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(postTypesQuery),
  component: PostTypesPage,
})

function PostTypesPage() {
  const postTypes = useQuery(postTypesQuery)
  return (
    <div>
      <PageHeading
        title="投稿タイプ"
        description="記事の種類と分類方法を管理します。"
        actions={
          <Link
            to="/post-types/new"
            className="border border-neutral-950 bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"
          >
            新規作成
          </Link>
        }
      />
      <div className="mt-6">
        {postTypes.data?.items.length === 0 ? (
          <EmptyState>投稿タイプはありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 bg-white">
            <table className="w-full min-w-2xl text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3 font-medium">名前</th>
                  <th className="px-4 py-3 font-medium">スラッグ</th>
                  <th className="px-4 py-3 font-medium">分類</th>
                  <th className="px-4 py-3 font-medium">表示順</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {postTypes.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <Link
                        to="/post-types/$id"
                        params={{ id: String(item.id) }}
                        className="font-medium underline underline-offset-4"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{item.slug}</td>
                    <td className="px-4 py-3">
                      {[item.hasCategories && 'カテゴリ', item.hasTags && 'タグ']
                        .filter(Boolean)
                        .join(' / ') || 'なし'}
                    </td>
                    <td className="px-4 py-3">{item.sortOrder}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
