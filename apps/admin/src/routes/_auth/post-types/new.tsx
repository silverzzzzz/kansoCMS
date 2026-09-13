import { slugify } from '@kanso/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { unwrap } from '../../../api/request.ts'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { PostTypeForm } from '../../../components/PostTypeForm.tsx'
import { Alert } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/post-types/new')({ component: NewPostTypePage })

function NewPostTypePage() {
  const navigate = useNavigate({ from: '/post-types/new' })
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [hasCategories, setHasCategories] = useState(true)
  const [hasTags, setHasTags] = useState(true)
  const [sortOrder, setSortOrder] = useState(0)
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api['post-types'].$post({
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
  const errors = fieldErrors(save.error)
  return (
    <div>
      <PageHeading title="投稿タイプを作成" />
      {save.error && Object.keys(errors).length === 0 && (
        <div className="mt-6">
          <Alert tone="error">
            {save.error instanceof ApiError ? save.error.message : '保存できませんでした'}
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
        onName={(next) => {
          setName(next)
          if (!slugEdited) setSlug(slugify(next))
        }}
        onSlug={(next) => {
          setSlugEdited(true)
          setSlug(next)
        }}
        onDescription={setDescription}
        onCategories={setHasCategories}
        onTags={setHasTags}
        onSortOrder={setSortOrder}
        onSubmit={() => save.mutate()}
      />
    </div>
  )
}
