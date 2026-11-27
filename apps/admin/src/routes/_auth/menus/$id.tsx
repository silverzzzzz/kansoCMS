import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../../api/client.ts'
import { menuQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { useCreatedNotice } from '../../../components/editing/created-notice.ts'
import { MenuForm } from '../../../components/MenuForm.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'

export const Route = createFileRoute('/_auth/menus/$id')({
  remountDeps: ({ params }) => params.id,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(menuQuery(Number(params.id))),
  component: EditMenuPage,
})

function EditMenuPage() {
  const { id } = Route.useParams()
  const initialSaved = useCreatedNotice('menus', Number(id))
  const queryClient = useQueryClient()
  const { data } = useQuery(menuQuery(Number(id)))
  if (!data) return null
  const { name, slug, itemsJson } = data.item
  return (
    <div>
      <PageHeading title={`メニューを編集: ${name}`} />
      <MenuForm
        initialSaved={initialSaved}
        initial={{ name, slug, items: itemsJson }}
        onSave={async (input) => {
          await unwrap(api.menus[':id'].$patch({ param: { id }, json: input }))
          await queryClient.invalidateQueries({ queryKey: ['menus'] })
        }}
      />
    </div>
  )
}
