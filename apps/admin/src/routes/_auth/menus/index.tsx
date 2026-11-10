import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { type MenuListItem, menusListQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, EmptyState } from '../../../components/ui.tsx'
import { formatDateTime } from '../../../lib/datetime.ts'

export const Route = createFileRoute('/_auth/menus/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(menusListQuery),
  component: MenusPage,
})

function MenusPage() {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState<MenuListItem | null>(null)
  const menus = useQuery(menusListQuery)
  const remove = useMutation({
    mutationFn: () =>
      deleting
        ? unwrap(api.menus[':id'].$delete({ param: { id: String(deleting.id) } }))
        : Promise.reject(new Error('削除対象がありません')),
    onSuccess: async () => {
      setDeleting(null)
      await queryClient.invalidateQueries({ queryKey: ['menus'] })
    },
  })
  const error = remove.error ?? menus.error

  return (
    <div>
      <PageHeading
        title="メニュー"
        description="ナビゲーションメニューを管理します。スラッグ header のメニューがサイトのナビゲーションに使われます。"
        actions={
          <Link
            to="/menus/new"
            className="border border-neutral-950 bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"
          >
            新規作成
          </Link>
        }
      />
      {error && (
        <div className="mt-6">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <div className="mt-6">
        {menus.data?.items.length === 0 ? (
          <EmptyState>
            メニューはありません。作成しない場合、ナビゲーションは固定ページと投稿タイプから自動生成されます。
          </EmptyState>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 bg-white">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
                <tr>
                  <th className="px-4 py-3 font-medium">名前</th>
                  <th className="px-4 py-3 font-medium">スラッグ</th>
                  <th className="px-4 py-3 font-medium">項目数</th>
                  <th className="px-4 py-3 font-medium">更新日時</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {menus.data?.items.map((menu) => (
                  <tr key={menu.id}>
                    <td className="px-4 py-3">
                      <Link
                        to="/menus/$id"
                        params={{ id: String(menu.id) }}
                        className="font-medium underline underline-offset-4"
                      >
                        {menu.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs">{menu.slug}</code>
                      {menu.slug === 'header' && (
                        <span className="ml-2 border border-neutral-950 px-1.5 py-0.5 text-xs font-medium">
                          ナビ使用中
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{menu.itemsJson.length}</td>
                    <td className="px-4 py-3 text-neutral-500">{formatDateTime(menu.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Link
                          to="/menus/$id"
                          params={{ id: String(menu.id) }}
                          className="border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-950"
                        >
                          編集
                        </Link>
                        <Button
                          type="button"
                          size="small"
                          variant="danger"
                          onClick={() => setDeleting(menu)}
                        >
                          削除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="メニューを削除"
        description={`「${deleting?.name ?? ''}」を削除します。header メニューを削除するとナビゲーションは自動生成に戻ります。`}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
