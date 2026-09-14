import type { CreateFormInput } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../../api/client.ts'
import { ApiError } from '../../../../api/errors.ts'
import { formQuery, formsListQuery } from '../../../../api/queries.ts'
import { unwrap } from '../../../../api/request.ts'
import { ConfirmDialog } from '../../../../components/ConfirmDialog.tsx'
import { FormEditor } from '../../../../components/forms/FormEditor.tsx'
import { PageHeading } from '../../../../components/PageHeading.tsx'
import { Alert, Button } from '../../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/forms/$id/')({
  remountDeps: ({ params }) => params.id,
  loader: async ({ context, params }) => {
    const id = Number(params.id)
    await Promise.all([
      context.queryClient.ensureQueryData(formQuery(id)),
      context.queryClient.ensureQueryData(formsListQuery),
    ])
  },
  component: EditFormPage,
})

function EditFormPage() {
  const { id: idParam } = Route.useParams()
  const id = Number(idParam)
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/forms/$id/' })
  const form = useQuery(formQuery(id))
  const forms = useQuery(formsListQuery)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const save = useMutation({
    mutationFn: (input: CreateFormInput) =>
      unwrap(api.forms[':id'].$patch({ param: { id: String(id) }, json: input })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['forms'] })
      await navigate({ to: '/forms' })
    },
  })
  const remove = useMutation({
    mutationFn: () => unwrap(api.forms[':id'].$delete({ param: { id: String(id) } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['forms'] })
      await navigate({ to: '/forms' })
    },
  })
  const item = form.data?.item

  if (!item) return <p>読み込み中…</p>
  return (
    <div>
      <PageHeading
        title="フォームを編集"
        actions={
          <>
            <Link
              to="/forms/$id/submissions"
              params={{ id: String(id) }}
              className="border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:border-neutral-950"
            >
              送信一覧
            </Link>
            <Button type="button" variant="danger" onClick={() => setConfirmOpen(true)}>
              削除
            </Button>
          </>
        }
      />
      {remove.error && (
        <div className="mt-6">
          <Alert tone="error">
            {remove.error instanceof ApiError ? remove.error.message : '削除できませんでした'}
          </Alert>
        </div>
      )}
      <FormEditor
        initial={item}
        turnstileAvailable={forms.data?.turnstileAvailable ?? false}
        pending={save.isPending}
        error={save.error}
        onSubmit={(input) => save.mutate(input)}
      />
      <ConfirmDialog
        open={confirmOpen}
        title="フォームを削除"
        description="このフォームを削除します。受信した送信もすべて削除されます。"
        pending={remove.isPending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
