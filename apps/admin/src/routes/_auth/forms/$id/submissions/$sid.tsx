import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../../../api/client.ts'
import { ApiError } from '../../../../../api/errors.ts'
import { formQuery, submissionQuery } from '../../../../../api/queries.ts'
import { unwrap } from '../../../../../api/request.ts'
import { ConfirmDialog } from '../../../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../../../components/PageHeading.tsx'
import { Alert, Button } from '../../../../../components/ui.tsx'
import { formatDateTime } from '../../../../../lib/datetime.ts'

function displayValue(value: string | boolean | undefined): string {
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ'
  return value === undefined ? '—' : value
}

export const Route = createFileRoute('/_auth/forms/$id/submissions/$sid')({
  remountDeps: ({ params }) => `${params.id}:${params.sid}`,
  loader: async ({ context, params }) => {
    const id = Number(params.id)
    const submissionId = Number(params.sid)
    await Promise.all([
      context.queryClient.ensureQueryData(formQuery(id)),
      context.queryClient.ensureQueryData(submissionQuery(id, submissionId)),
    ])
  },
  component: SubmissionPage,
})

function SubmissionPage() {
  const { id: idParam, sid: sidParam } = Route.useParams()
  const id = Number(idParam)
  const submissionId = Number(sidParam)
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/forms/$id/submissions/$sid' })
  const form = useQuery(formQuery(id))
  const submission = useQuery(submissionQuery(id, submissionId))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const autoMarked = useRef(false)
  const changeRead = useMutation({
    mutationFn: (read: boolean) =>
      unwrap(
        api.forms[':id'].submissions[':submissionId'].$patch({
          param: { id: String(id), submissionId: String(submissionId) },
          json: { read },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['forms'] })
    },
  })
  const remove = useMutation({
    mutationFn: () =>
      unwrap(
        api.forms[':id'].submissions[':submissionId'].$delete({
          param: { id: String(id), submissionId: String(submissionId) },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['forms'] })
      await navigate({ to: '/forms/$id/submissions', params: { id: String(id) } })
    },
  })
  const item = submission.data?.item
  const mutateRead = changeRead.mutate

  useEffect(() => {
    if (!item || item.readAt !== null || changeRead.isPending || autoMarked.current) return
    autoMarked.current = true
    mutateRead(true)
  }, [item, changeRead.isPending, mutateRead])

  if (!item || !form.data?.item) return <p>読み込み中…</p>
  const formItem = form.data.item
  const fieldNames = new Set(formItem.fieldsJson.map((field) => field.name))
  const otherValues = Object.entries(item.dataJson).filter(([key]) => !fieldNames.has(key))
  const meta = item.metaJson

  return (
    <div>
      <Link
        to="/forms/$id/submissions"
        params={{ id: String(id) }}
        className="mb-4 inline-block text-sm underline underline-offset-4"
      >
        送信一覧へ戻る
      </Link>
      <PageHeading
        title={`${formItem.name}の送信`}
        description={`送信 #${item.id}`}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={changeRead.isPending}
              onClick={() => changeRead.mutate(item.readAt === null)}
            >
              {item.readAt === null ? '既読にする' : '未読に戻す'}
            </Button>
            <Button type="button" variant="danger" onClick={() => setConfirmOpen(true)}>
              削除
            </Button>
          </>
        }
      />
      {(changeRead.error || remove.error) && (
        <div className="mt-6">
          <Alert tone="error">
            {(changeRead.error ?? remove.error) instanceof ApiError
              ? (changeRead.error ?? remove.error)?.message
              : '処理できませんでした'}
          </Alert>
        </div>
      )}

      <section className="mt-6 border border-neutral-200 bg-white">
        <h2 className="border-b border-neutral-200 px-5 py-4 text-lg font-semibold">送信内容</h2>
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-neutral-200">
            {formItem.fieldsJson.map((field) => (
              <tr key={field.name}>
                <th className="w-48 bg-neutral-50 px-4 py-3 align-top font-medium text-neutral-700">
                  {field.label}
                </th>
                <td className="whitespace-pre-wrap px-4 py-3">
                  {displayValue(item.dataJson[field.name])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {otherValues.length > 0 && (
          <div className="border-t border-neutral-300 px-5 py-4">
            <h3 className="text-sm font-semibold">その他</h3>
            <dl className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
              {otherValues.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[12rem_1fr] text-sm">
                  <dt className="bg-neutral-50 px-4 py-3 font-medium text-neutral-700">{key}</dt>
                  <dd className="whitespace-pre-wrap px-4 py-3">{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      <section className="mt-6 border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold">メタ情報</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-neutral-600">受信日時</dt>
            <dd className="mt-1">{formatDateTime(item.createdAt)}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-600">IP</dt>
            <dd className="mt-1 break-all">{meta.ip ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-600">User-Agent</dt>
            <dd className="mt-1 break-all">{meta.userAgent ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-600">リファラー</dt>
            <dd className="mt-1 break-all">{meta.referrer ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-600">国</dt>
            <dd className="mt-1">{meta.country ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title="送信を削除"
        description="この送信を削除します。この操作は取り消せません。"
        pending={remove.isPending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
