import {
  GONE_STATUS,
  NOT_FOUND_PER_PAGE,
  REDIRECT_STATUSES,
  type RedirectStatus,
} from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { notFoundPathsQuery, type RedirectItem, redirectsQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, EmptyState, Field, inputClass } from '../../../components/ui.tsx'
import { formatDateTime } from '../../../lib/datetime.ts'

export const Route = createFileRoute('/_auth/redirects/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(redirectsQuery()),
  component: RedirectsPage,
})

const STATUS_LABELS: Record<RedirectStatus, string> = {
  301: '301 恒久',
  302: '302 一時',
  410: '410 削除済み',
}

function StatusOptions() {
  return REDIRECT_STATUSES.map((value) => (
    <option key={value} value={value}>
      {STATUS_LABELS[value]}
    </option>
  ))
}

function RedirectsPage() {
  const queryClient = useQueryClient()
  const createFormRef = useRef<HTMLFormElement>(null)
  const toInputRef = useRef<HTMLInputElement>(null)
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
  const [csv, setCsv] = useState('')
  const [importResult, setImportResult] = useState<{
    created: number
    updated: number
    errors: { line: number; message: string }[]
    truncated: boolean
  } | null>(null)
  const redirects = useQuery(redirectsQuery(search || undefined))
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['redirects'] })
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.redirects.$post({
          json: { fromPath, to: status === GONE_STATUS ? '' : to, status },
        }),
      ),
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
              json: {
                fromPath: editFromPath,
                to: editStatus === GONE_STATUS ? '' : editTo,
                status: editStatus,
              },
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
  const importCsv = useMutation({
    mutationFn: () => unwrap(api.redirects.import.$post({ json: { csv } })),
    onSuccess: async (result) => {
      setImportResult(result)
      await invalidate()
    },
  })
  const error = create.error ?? update.error ?? remove.error ?? importCsv.error ?? redirects.error

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
        ref={createFormRef}
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
            ref={toInputRef}
            className={inputClass}
            value={status === GONE_STATUS ? '' : to}
            required={status !== GONE_STATUS}
            disabled={status === GONE_STATUS}
            placeholder={
              status === GONE_STATUS ? '(410 は転送先なし)' : '/new/path または https://…'
            }
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
        <Field label="種類">
          <select
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(Number(event.target.value) as RedirectStatus)}
          >
            <StatusOptions />
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={create.isPending}>
            追加
          </Button>
        </div>
      </form>
      <details className="mt-6 border border-neutral-200 bg-white p-5">
        <summary className="cursor-pointer text-sm font-medium">
          CSV インポート (最大 500 行)
        </summary>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            setImportResult(null)
            importCsv.mutate()
          }}
        >
          <Field
            label="CSV"
            hint="1 行に `転送元,転送先[,種類]`。種類は 301・302・410 (省略時 301)。410 (削除済み) は転送先を空にします (`/old,,410`)。ヘッダ行は任意。同じ転送元は上書きされます。"
          >
            <textarea
              className={`${inputClass} font-mono text-xs`}
              rows={8}
              value={csv}
              required
              placeholder={'/old-path,/new-path,301\n/legacy,/modern'}
              onChange={(event) => setCsv(event.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={importCsv.isPending}>
              {importCsv.isPending ? 'インポート中…' : 'インポート'}
            </Button>
          </div>
        </form>
        {importResult && (
          <div className="mt-4 space-y-2">
            <Alert tone="success">
              {importResult.created} 件を追加、{importResult.updated} 件を更新しました。
              {importResult.truncated && ' (500 行を超えた分は無視されました)'}
            </Alert>
            {importResult.errors.length > 0 && (
              <Alert tone="error">
                エラー:
                <ul className="mt-1 list-inside list-disc">
                  {importResult.errors.map((entry) => (
                    <li key={entry.line}>
                      {entry.line} 行目: {entry.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </details>
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
                            value={editStatus === GONE_STATUS ? '' : editTo}
                            required={editStatus !== GONE_STATUS}
                            disabled={editStatus === GONE_STATUS}
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
                          <StatusOptions />
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
                        {redirect.status === GONE_STATUS ? (
                          <span className="ml-2 text-neutral-500">(転送先なし)</span>
                        ) : (
                          <>
                            <span className="mx-2 text-neutral-400" aria-hidden="true">
                              →
                            </span>
                            <span className="break-all text-neutral-600">{redirect.to}</span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3">{STATUS_LABELS[redirect.status]}</td>
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
      <NotFoundPaths
        onRedirect={(path) => {
          setFromPath(`/${path}`)
          setStatus(301)
          createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          toInputRef.current?.focus({ preventScroll: true })
        }}
      />
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

/**
 * Public paths that answered 404 (counted by the site, kept 30 days). Each can
 * get a redirect (prefilled in the form above), become a 410, or be dismissed.
 */
function NotFoundPaths({ onRedirect }: { onRedirect: (path: string) => void }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [clearOpen, setClearOpen] = useState(false)
  const missing = useQuery(notFoundPathsQuery(page))
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['redirects'] })
  const markGone = useMutation({
    mutationFn: (path: string) =>
      unwrap(api.redirects.$post({ json: { fromPath: path, to: '', status: GONE_STATUS } })),
    onSuccess: invalidate,
  })
  const dismiss = useMutation({
    mutationFn: (path?: string) =>
      unwrap(api.redirects['not-found'].$delete({ query: path ? { path } : {} })),
    onSuccess: async () => {
      setClearOpen(false)
      await invalidate()
    },
  })
  const error = markGone.error ?? dismiss.error ?? missing.error
  const total = missing.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / NOT_FOUND_PER_PAGE))

  return (
    <section className="mt-10" aria-labelledby="not-found-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="not-found-heading" className="text-lg font-semibold">
            見つからなかった URL
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            {
              '公開サイトで 404 になったパスです (30 日以内)。リダイレクトか 410 を設定すると一覧から消えます。'
            }
          </p>
        </div>
        {total > 0 && (
          <Button type="button" variant="secondary" size="small" onClick={() => setClearOpen(true)}>
            すべて消す
          </Button>
        )}
      </div>
      {error && (
        <div className="mt-4">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <div className="mt-4">
        {total === 0 ? (
          <EmptyState>見つからなかった URL はありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 bg-white">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
                <tr>
                  <th className="px-4 py-3 font-medium">パス</th>
                  <th className="px-4 py-3 text-right font-medium">回数</th>
                  <th className="px-4 py-3 font-medium">最後のアクセス</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {missing.data?.items.map((item) => (
                  <tr key={item.path}>
                    <td className="break-all px-4 py-3 font-medium">/{item.path}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{item.count}</td>
                    <td className="px-4 py-3 text-neutral-500">{formatDateTime(item.lastSeen)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="small" onClick={() => onRedirect(item.path)}>
                          リダイレクトを作る
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="secondary"
                          disabled={markGone.isPending}
                          onClick={() => markGone.mutate(item.path)}
                        >
                          410 にする
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="secondary"
                          disabled={dismiss.isPending}
                          onClick={() => dismiss.mutate(item.path)}
                        >
                          一覧から消す
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
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-3 text-sm">
          <Button
            type="button"
            size="small"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            前へ
          </Button>
          <span>
            {page} / {pages}
          </span>
          <Button
            type="button"
            size="small"
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            次へ
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={clearOpen}
        title="見つからなかった URL をすべて消す"
        description="記録した 404 のパスを一覧からすべて消します。リダイレクトは変わりません。"
        pending={dismiss.isPending}
        onClose={() => setClearOpen(false)}
        onConfirm={() => dismiss.mutate(undefined)}
      />
    </section>
  )
}
