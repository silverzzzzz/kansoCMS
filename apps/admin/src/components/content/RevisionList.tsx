import type { ContentStatus } from '@kanso/shared'
import { formatDateTime } from '../../lib/datetime.ts'
import { Button, EmptyState } from '../ui.tsx'

type RevisionItem = {
  id: number
  createdAt: string
  user: { id: number; name: string } | null
  title: string
  status: ContentStatus
}

export function RevisionList({
  title = '履歴',
  items,
  pending,
  onRestore,
}: {
  title?: string
  items: RevisionItem[]
  pending: boolean
  onRestore: (revisionId: number) => void
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-neutral-600">
        保存前の状態を最新 20 件まで保持します。復元すると現在の内容も履歴に残ります。
      </p>
      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState>履歴はまだありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 bg-white">
            <table className="w-full min-w-3xl text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3 font-medium">日時</th>
                  <th className="px-4 py-3 font-medium">ユーザー</th>
                  <th className="px-4 py-3 font-medium">タイトル</th>
                  <th className="px-4 py-3 font-medium">状態</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="px-4 py-3">{item.user?.name ?? '—'}</td>
                    <td className="px-4 py-3">{item.title}</td>
                    <td className="px-4 py-3">{item.status === 'published' ? '公開' : '下書き'}</td>
                    <td className="px-4 py-3">
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => onRestore(item.id)}
                      >
                        復元
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
