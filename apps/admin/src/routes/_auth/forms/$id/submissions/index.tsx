import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { api } from '../../../../../api/client.ts'
import { ApiError } from '../../../../../api/errors.ts'
import {
  formQuery,
  type SubmissionsListParams,
  submissionsListQuery,
} from '../../../../../api/queries.ts'
import { unwrap } from '../../../../../api/request.ts'
import { PageHeading } from '../../../../../components/PageHeading.tsx'
import { Pagination } from '../../../../../components/Pagination.tsx'
import { Alert, Button, EmptyState } from '../../../../../components/ui.tsx'
import { formatDateTime } from '../../../../../lib/datetime.ts'

type SubmissionSearch = { page?: number; unread?: boolean }

function queryParams(search: SubmissionSearch): SubmissionsListParams {
  return {
    page: String(search.page ?? 1),
    perPage: '20',
    unread: search.unread ? 'true' : undefined,
  }
}

function displayValue(value: string | boolean | undefined): string {
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ'
  return value || '—'
}

export const Route = createFileRoute('/_auth/forms/$id/submissions/')({
  validateSearch: (search: Record<string, unknown>): SubmissionSearch => ({
    page: typeof search.page === 'number' && search.page >= 1 ? Math.floor(search.page) : undefined,
    unread: search.unread === true ? true : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps }) => {
    const id = Number(params.id)
    await Promise.all([
      context.queryClient.ensureQueryData(formQuery(id)),
      context.queryClient.ensureQueryData(submissionsListQuery(id, queryParams(deps))),
    ])
  },
  component: SubmissionsPage,
})

function SubmissionsPage() {
  const { id: idParam } = Route.useParams()
  const id = Number(idParam)
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const form = useQuery(formQuery(id))
  const submissions = useQuery(submissionsListQuery(id, queryParams(search)))
  const changeRead = useMutation({
    mutationFn: ({ submissionId, read }: { submissionId: number; read: boolean }) =>
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
  const item = form.data?.item
  const previewFields =
    item?.fieldsJson.filter((field) => field.type !== 'checkbox').slice(0, 2) ?? []
  const page = search.page ?? 1

  if (!item) return <p>読み込み中…</p>
  return (
    <div>
      <PageHeading
        title={`${item.name}の送信`}
        description={`slug: ${item.slug}`}
        actions={
          <>
            <label className="flex items-center gap-2 border border-neutral-300 bg-white px-3 py-2.5 text-sm font-medium text-neutral-800">
              <input
                type="checkbox"
                checked={search.unread ?? false}
                onChange={(event) =>
                  void navigate({
                    search: { page: undefined, unread: event.target.checked ? true : undefined },
                  })
                }
              />
              未読のみ
            </label>
            <a
              href={`/api/v1/forms/${id}/submissions/export.csv`}
              download
              className="border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:border-neutral-950"
            >
              CSV ダウンロード
            </a>
            <Link
              to="/forms/$id"
              params={{ id: String(id) }}
              className="border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:border-neutral-950"
            >
              フォームを編集
            </Link>
          </>
        }
      />
      {changeRead.error && (
        <div className="mt-6">
          <Alert tone="error">
            {changeRead.error instanceof ApiError
              ? changeRead.error.message
              : '状態を変更できませんでした'}
          </Alert>
        </div>
      )}
      <div className="mt-6">
        {submissions.data?.items.length === 0 ? (
          <EmptyState>送信はありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 bg-white">
            <table className="w-full min-w-3xl text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3 font-medium">受信日時</th>
                  <th className="px-4 py-3 font-medium">状態</th>
                  {previewFields.map((field) => (
                    <th key={field.name} className="px-4 py-3 font-medium">
                      {field.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {submissions.data?.items.map((submission) => {
                  const unread = submission.readAt === null
                  return (
                    <tr key={submission.id} className={unread ? 'font-semibold' : undefined}>
                      <td className="px-4 py-3">
                        <Link
                          to="/forms/$id/submissions/$sid"
                          params={{ id: String(id), sid: String(submission.id) }}
                          className="underline underline-offset-4"
                        >
                          {formatDateTime(submission.createdAt)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{unread ? '未読' : '既読'}</td>
                      {previewFields.map((field) => (
                        <td key={field.name} className="max-w-xs px-4 py-3 text-neutral-600">
                          <span className="block truncate">
                            {displayValue(submission.dataJson[field.name])}
                          </span>
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <Button
                          type="button"
                          size="small"
                          variant="secondary"
                          disabled={
                            changeRead.isPending &&
                            changeRead.variables?.submissionId === submission.id
                          }
                          onClick={() =>
                            changeRead.mutate({ submissionId: submission.id, read: unread })
                          }
                        >
                          {unread ? '既読にする' : '未読に戻す'}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {submissions.data && (
        <Pagination
          page={page}
          perPage={20}
          total={submissions.data.total}
          onChange={(nextPage) =>
            void navigate({ search: { ...search, page: nextPage === 1 ? undefined : nextPage } })
          }
        />
      )}
    </div>
  )
}
