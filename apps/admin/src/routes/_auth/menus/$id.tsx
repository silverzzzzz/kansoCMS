import type { MenuItem } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { menuQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { MenuForm } from '../../../components/MenuForm.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert } from '../../../components/ui.tsx'

export const Route = createFileRoute('/_auth/menus/$id')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(menuQuery(Number(params.id))),
  component: EditMenuPage,
})

function EditMenuPage() {
  const { id } = Route.useParams()
  const menuId = Number(id)
  const navigate = useNavigate({ from: '/menus/$id' })
  const queryClient = useQueryClient()
  const menu = useQuery(menuQuery(menuId))
  const [name, setName] = useState<string | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [items, setItems] = useState<MenuItem[] | null>(null)
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.menus[':id'].$patch({
          param: { id },
          json: {
            name: name ?? menu.data?.item.name,
            slug: slug ?? menu.data?.item.slug,
            items: items ?? menu.data?.item.itemsJson,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['menus'] })
      await navigate({ to: '/menus' })
    },
  })
  const errors = fieldErrors(save.error)

  if (!menu.data) return null
  const current = menu.data.item

  return (
    <div>
      <PageHeading title={`メニューを編集: ${current.name}`} />
      {save.error && Object.keys(errors).length === 0 && (
        <div className="mt-6">
          <Alert tone="error">
            {save.error instanceof ApiError ? save.error.message : '保存できませんでした'}
          </Alert>
        </div>
      )}
      <MenuForm
        name={name ?? current.name}
        slug={slug ?? current.slug}
        items={items ?? current.itemsJson}
        errors={errors}
        pending={save.isPending}
        onName={setName}
        onSlug={setSlug}
        onItems={setItems}
        onSubmit={() => save.mutate()}
      />
    </div>
  )
}
