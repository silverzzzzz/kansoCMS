import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { postTypeQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { CategoryManager } from '../../../components/CategoryManager.tsx'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
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
  const [name, setName] = useState(item?.name ?? '')
  const [slug, setSlug] = useState(item?.slug ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [hasCategories, setHasCategories] = useState(item?.hasCategories ?? true)
  const [hasTags, setHasTags] = useState(item?.hasTags ?? true)
  const [sortOrder, setSortOrder] = useState(item?.sortOrder ?? 0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api['post-types'][':id'].$patch({
          param: { id: String(id) },
          json: {
            name,
            slug,
            description: description.trim() || null,
            hasCategories,
            hasTags,
            sortOrder,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['post-types'] })
      await navigate({ to: '/post-types' })
    },
  })
  const remove = useMutation({
    mutationFn: () => unwrap(api['post-types'][':id'].$delete({ param: { id: String(id) } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['post-types'] })
      await navigate({ to: '/post-types' })
    },
  })
  const errors = fieldErrors(save.error)
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
      {(remove.error || (save.error && Object.keys(errors).length === 0)) && (
        <div className="mt-6">
          <Alert tone="error">
            {(remove.error ?? save.error) instanceof ApiError
              ? (remove.error ?? save.error)?.message
              : '処理できませんでした'}
          </Alert>
        </div>
      )}
      <PostTypeForm
        name={name}
        slug={slug}
        description={description}
        hasCategories={hasCategories}
        hasTags={hasTags}
        sortOrder={sortOrder}
        errors={errors}
        pending={save.isPending}
        onName={setName}
        onSlug={setSlug}
        onDescription={setDescription}
        onCategories={setHasCategories}
        onTags={setHasTags}
        onSortOrder={setSortOrder}
        onSubmit={() => save.mutate()}
      />
      {hasCategories && <CategoryManager typeId={id} />}
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
