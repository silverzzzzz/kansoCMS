import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { postTypeQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { CategoryManager } from '../../../components/CategoryManager.tsx'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { useCreatedNotice } from '../../../components/editing/created-notice.ts'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { PostTypeForm } from '../../../components/PostTypeForm.tsx'
import { Alert, Button } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/post-types/$id')({
  remountDeps: ({ params }) => params.id,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(postTypeQuery(Number(params.id))),
  component: EditPostTypePage,
})

function EditPostTypePage() {
  const id = Number(Route.useParams().id)
  const navigate = useNavigate({ from: '/post-types/$id' })
  const queryClient = useQueryClient()
  const query = useQuery(postTypeQuery(id))
  const item = query.data?.item
  const initialSaved = useCreatedNotice('post-types', Number(id))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const remove = useMutation({
    mutationFn: () => unwrap(api['post-types'][':id'].$delete({ param: { id: String(id) } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['post-types'] })
      await navigate({ to: '/post-types', ignoreBlocker: true })
    },
  })
  if (!item) return <p>読み込み中…</p>
  return (
    <div>
      <PageHeading
        title="投稿タイプを編集"
        actions={
          <Button type="button" variant="danger" onClick={() => setConfirmOpen(true)}>
            削除
          </Button>
        }
      />
      {remove.error && (
        <Alert tone="error">
          {remove.error instanceof ApiError ? remove.error.message : '削除できませんでした'}
        </Alert>
      )}
      <PostTypeForm
        categoryManager={<CategoryManager typeId={id} />}
        initialSaved={initialSaved}
        initial={{
          name: item.name,
          slug: item.slug,
          description: item.description ?? '',
          hasCategories: item.hasCategories,
          hasTags: item.hasTags,
          noindex: item.noindex,
          fields: item.fieldsJson ?? [],
          sortOrder: item.sortOrder,
        }}
        onSave={async (input) => {
          await unwrap(
            api['post-types'][':id'].$patch({
              param: { id: String(id) },
              json: { ...input, description: input.description.trim() || null },
            }),
          )
          await queryClient.invalidateQueries({ queryKey: ['post-types'] })
        }}
      />
      <ConfirmDialog
        open={confirmOpen}
        title="投稿タイプを削除"
        description="この投稿タイプを削除します。投稿が残っている場合は削除できません。"
        pending={remove.isPending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
