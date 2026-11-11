import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../api/client.ts'
import { unwrap } from '../../api/request.ts'
import { PageHeading } from '../../components/PageHeading.tsx'
import { Alert } from '../../components/ui.tsx'

export const Route = createFileRoute('/_auth/activity')({
  component: ActivityPage,
})

const formatDateTime = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Audit trail (T58): newest mutations first, capped at 100 rows. */
function ActivityPage() {
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () => unwrap(api.activity.$get({ query: { limit: '100' } })),
  })

  return (
    <div>
      <PageHeading title="アクティビティ" description="最近の変更履歴 (最大 100 件)。" />
      {activity.error && (
        <div className="mt-6">
          <Alert tone="error">アクティビティを読み込めませんでした</Alert>
        </div>
      )}
      <div className="mt-8 overflow-x-auto border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3">日時</th>
              <th className="px-4 py-3">操作者</th>
              <th className="px-4 py-3">対象</th>
              <th className="px-4 py-3">内容</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {(activity.data?.items ?? []).map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                  {formatDateTime.format(new Date(row.createdAt))}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{row.actor}</td>
                <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                  {row.targetType}
                  {row.targetId ? ` #${row.targetId}` : ''}
                </td>
                <td className="px-4 py-3">
                  {row.summary}
                  {row.count > 1 && <span className="ml-2 text-neutral-500">({row.count} 回)</span>}
                </td>
              </tr>
            ))}
            {!activity.isPending && (activity.data?.items ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                  まだ記録がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
