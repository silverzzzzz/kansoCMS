import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { formsListQuery } from '../../../api/queries.ts'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { EmptyState } from '../../../components/ui.tsx'
import { formatDateTime } from '../../../lib/datetime.ts'

export const Route = createFileRoute('/_auth/forms/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(formsListQuery),
  component: FormsPage,
})

function FormsPage() {
  const forms = useQuery(formsListQuery)

  return (
    <div>
      <PageHeading
        title="フォーム"
        description="フォームの項目と受信した送信を管理します。"
        actions={
          <Link
            to="/forms/new"
            className="border border-neutral-950 bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"
          >
            新規作成
          </Link>
        }
      />
      <div className="mt-6">
        {forms.data?.items.length === 0 ? (
          <EmptyState>フォームはありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 bg-white">
            <table className="w-full min-w-3xl text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3 font-medium">名前</th>
                  <th className="px-4 py-3 font-medium">slug</th>
                  <th className="px-4 py-3 font-medium">送信</th>
                  <th className="px-4 py-3 font-medium">Turnstile</th>
                  <th className="px-4 py-3 font-medium">更新日時</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {forms.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <Link
                        to="/forms/$id"
                        params={{ id: String(item.id) }}
                        className="font-medium underline underline-offset-4"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      <code>{item.slug}</code>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to="/forms/$id/submissions"
                        params={{ id: String(item.id) }}
                        className="inline-flex items-center gap-2 underline underline-offset-4"
                      >
                        {item.submissionCount}
                        {item.unreadCount > 0 && (
                          <span className="border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-xs font-bold text-neutral-950 no-underline">
                            未読 {item.unreadCount}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{item.turnstile ? 'ON' : 'OFF'}</td>
                    <td className="px-4 py-3 text-neutral-600">{formatDateTime(item.updatedAt)}</td>
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
