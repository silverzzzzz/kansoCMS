import type { RedirectStatus } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { type RedirectItem, redirectsQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, EmptyState, Field, inputClass } from '../../../components/ui.tsx'
import { formatDateTime } from '../../../lib/datetime.ts'

export const Route = createFileRoute('/_auth/redirects/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(redirectsQuery()),
  component: RedirectsPage,
})

function RedirectsPage() {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [fromPath, setFromPath] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<RedirectStatus>(301)
  const [editing, setEditing] = useState<RedirectItem | null>(null)
  const [editFromPath, setEditFromPath] = useState('')
  const [editTo, setEditTo] = useState('')
  const [editStatus, setEditStatus] = useState<RedirectStatus>(301)
  const [deleting, setDeleting] = useState<RedirectItem | null>(null)
  const redirects = useQuery(redirectsQuery(search || undefined))
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['redirects'] })
  const create = useMutation({
    mutationFn: () => unwrap(api.redirects.$post({ json: { fromPath, to, status } })),
    onSuccess: async () => {
      setFromPath('')
      setTo('')
      setStatus(301)
      await invalidate()
    },
  })
  const update = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(
            api.redirects[':id'].$patch({
              param: { id: String(editing.id) },
              json: { fromPath: editFromPath, to: editTo, status: editStatus },
            }),
          )
        : Promise.reject(new Error('編集対象がありません')),
    onSuccess: async () => {
      setEditing(null)
      await invalidate()
    },
  })
  const remove = useMutation({
    mutationFn: () =>
      deleting
        ? unwrap(api.redirects[':id'].$delete({ param: { id: String(deleting.id) } }))
        : Promise.reject(new Error('削除対象がありません')),
    onSuccess: async () => {
      setDeleting(null)
      await invalidate()
    },
  })
  const error = create.error ?? update.error ?? remove.error ?? redirects.error

  return (
    <div>
      <PageHeading
        title="リダイレクト"
        description="旧 URL から新しい URL への転送を管理します。"
      />
      {error && (
        <div className="mt-6">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <form
        className="mt-6 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(input.trim())
        }}
      >
        <label className="sr-only" htmlFor="redirect-search">
          リダイレクトを検索
        </label>
        <input
          id="redirect-search"
          className={`${inputClass} mt-0 max-w-md`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="転送元または転送先で検索"
        />
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>
      <form
        className="mt-6 grid gap-4 border border-neutral-200 bg-white p-5 sm:grid-cols-[1fr_1fr_10rem_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field label="転送元パス">
          <input
            className={inputClass}
            value={fromPath}
            required
            placeholder="/old/path"
            onChange={(event) => setFromPath(event.target.value)}
          />
        </Field>
        <Field label="転送先">
          <input
            className={inputClass}
            value={to}
            required
            placeholder="/new/path または https://…"
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
        <Field label="種類">
          <select
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(Number(event.target.value) as RedirectStatus)}
          >
            <option value={301}>301 恒久</option>
            <option value={302}>302 一時</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={create.isPending}>
            追加
          </Button>
        </div>
      </form>
      <div className="mt-6">
        {redirects.data?.items.length === 0 ? (
          <EmptyState>リダイレクトはありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 bg-white">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
                <tr>
                  <th className="px-4 py-3 font-medium">転送元 → 転送先</th>
                  <th className="px-4 py-3 font-medium">種類</th>
                  <th className="px-4 py-3 font-medium">更新日時</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {redirects.data?.items.map((redirect) => {
                  const formId = `redirect-edit-${redirect.id}`
                  return editing?.id === redirect.id ? (
                    <tr key={redirect.id}>
                      <td className="px-4 py-3">
                        <form
                          id={formId}
                          className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault()
                            update.mutate()
                          }}
                        >
                          <label className="sr-only" htmlFor={`${formId}-from`}>
                            転送元パス
                          </label>
                          <input
                            id={`${formId}-from`}
                            className={`${inputClass} mt-0`}
                            value={editFromPath}
                            required
                            onChange={(event) => setEditFromPath(event.target.value)}
                          />
                          <span aria-hidden="true">→</span>
                          <label className="sr-only" htmlFor={`${formId}-to`}>
                            転送先
                          </label>
                          <input
                            id={`${formId}-to`}
                            className={`${inputClass} mt-0`}
                            value={editTo}
                            required
                            onChange={(event) => setEditTo(event.target.value)}
                          />
                        </form>
                      </td>
                      <td className="px-4 py-3">
                        <label className="sr-only" htmlFor={`${formId}-status`}>
                          種類
                        </label>
                        <select
                          id={`${formId}-status`}
                          form={formId}
                          className={`${inputClass} mt-0`}
                          value={editStatus}
                          onChange={(event) =>
                            setEditStatus(Number(event.target.value) as RedirectStatus)
                          }
                        >
                          <option value={301}>301 恒久</option>
                          <option value={302}>302 一時</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-neutral-500">
                        {formatDateTime(redirect.updatedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button form={formId} type="submit" size="small">
                            保存
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => setEditing(null)}
                          >
                            取消
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={redirect.id}>
                      <td className="px-4 py-3">
                        <span className="font-medium">/{redirect.fromPath}</span>
                        <span className="mx-2 text-neutral-400" aria-hidden="true">
                          →
                        </span>
                        <span className="break-all text-neutral-600">{redirect.to}</span>
                      </td>
                      <td className="px-4 py-3">
                        {redirect.status === 301 ? '301 恒久' : '302 一時'}
                      </td>
                      <td className="px-4 py-3 text-neutral-500">
                        {formatDateTime(redirect.updatedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              setEditing(redirect)
                              setEditFromPath(redirect.fromPath)
                              setEditTo(redirect.to)
                              setEditStatus(redirect.status)
                            }}
                          >
                            編集
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="danger"
                            onClick={() => setDeleting(redirect)}
                          >
                            削除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="リダイレクトを削除"
        description={`/${deleting?.fromPath ?? ''} のリダイレクトを削除します。`}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
