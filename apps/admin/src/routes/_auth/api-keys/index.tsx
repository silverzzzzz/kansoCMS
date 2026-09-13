import type { ApiKeyScope } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { apiKeysQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, Field, inputClass } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/api-keys/')({
  loader: ({ context }) =>
    context.user.role === 'admin' ? context.queryClient.ensureQueryData(apiKeysQuery) : undefined,
  component: ApiKeysPage,
})

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '未使用'
}

function ApiKeysPage() {
  const { user } = Route.useRouteContext()
  const enabled = user.role === 'admin'
  const queryClient = useQueryClient()
  const keys = useQuery({ ...apiKeysQuery, enabled })
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiKeyScope>('read')
  const [rawKey, setRawKey] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null)
  const create = useMutation({
    mutationFn: () => unwrap(api['api-keys'].$post({ json: { name, scope } })),
    onSuccess: async (data) => {
      setRawKey(data.key)
      setName('')
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
  const remove = useMutation({
    mutationFn: () =>
      deleting
        ? unwrap(api['api-keys'][':id'].$delete({ param: { id: String(deleting.id) } }))
        : Promise.reject(new Error('失効対象がありません')),
    onSuccess: async () => {
      setDeleting(null)
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
  if (!enabled)
    return (
      <div>
        <PageHeading title="API キー" />
        <div className="mt-6">
          <Alert tone="error">権限がありません</Alert>
        </div>
      </div>
    )
  return (
    <div>
      <PageHeading title="API キー" description="外部連携に使用する認証キーを発行します。" />
      {rawKey && (
        <div className="mt-6">
          <Alert tone="success">
            <p className="font-medium">API キーを発行しました。このキーは再表示できません。</p>
            <code className="mt-3 block overflow-x-auto border border-green-300 bg-white p-3 text-xs">
              {rawKey}
            </code>
            <Button
              type="button"
              size="small"
              variant="secondary"
              className="mt-3"
              onClick={() => void navigator.clipboard.writeText(rawKey)}
            >
              キーをコピー
            </Button>
          </Alert>
        </div>
      )}
      {(create.error || remove.error) && (
        <div className="mt-6">
          <Alert tone="error">
            {(create.error ?? remove.error) instanceof ApiError
              ? (create.error ?? remove.error)?.message
              : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <form
        className="mt-6 grid gap-4 border border-neutral-200 bg-white p-5 sm:grid-cols-[1fr_12rem_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          setRawKey(null)
          create.mutate()
        }}
      >
        <Field label="名前">
          <input
            className={inputClass}
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="スコープ">
          <select
            className={inputClass}
            value={scope}
            onChange={(event) => setScope(event.target.value as ApiKeyScope)}
          >
            <option value="read">read</option>
            <option value="write">write</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={create.isPending}>
            発行
          </Button>
        </div>
      </form>
      <div className="mt-6 overflow-x-auto border border-neutral-200 bg-white">
        <table className="w-full min-w-3xl text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3 font-medium">名前</th>
              <th className="px-4 py-3 font-medium">スコープ</th>
              <th className="px-4 py-3 font-medium">作成日時</th>
              <th className="px-4 py-3 font-medium">最終使用</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {keys.data?.items.map((key) => (
              <tr key={key.id}>
                <td className="px-4 py-3 font-medium">{key.name}</td>
                <td className="px-4 py-3">{key.scope}</td>
                <td className="px-4 py-3 text-neutral-600">{formatDate(key.createdAt)}</td>
                <td className="px-4 py-3 text-neutral-600">{formatDate(key.lastUsedAt)}</td>
                <td className="px-4 py-3">
                  <Button
                    type="button"
                    size="small"
                    variant="danger"
                    onClick={() => setDeleting({ id: key.id, name: key.name })}
                  >
                    失効
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="API キーを失効"
        description={`${deleting?.name ?? ''} を失効します。元に戻せません。`}
        confirmLabel="失効"
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
