import { type MenuItem, slugify } from '@kanso/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { unwrap } from '../../../api/request.ts'
import { MenuForm } from '../../../components/MenuForm.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/menus/new')({ component: NewMenuPage })

function NewMenuPage() {
  const navigate = useNavigate({ from: '/menus/new' })
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [items, setItems] = useState<MenuItem[]>([])
  const save = useMutation({
    mutationFn: () => unwrap(api.menus.$post({ json: { name, slug, items } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['menus'] })
      await navigate({ to: '/menus' })
    },
  })
  const errors = fieldErrors(save.error)
  return (
    <div>
      <PageHeading title="メニューを作成" />
      {save.error && Object.keys(errors).length === 0 && (
        <div className="mt-6">
          <Alert tone="error">
            {save.error instanceof ApiError ? save.error.message : '保存できませんでした'}
          </Alert>
        </div>
      )}
      <MenuForm
        name={name}
        slug={slug}
        items={items}
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
        onItems={setItems}
        onSubmit={() => save.mutate()}
      />
    </div>
  )
}
