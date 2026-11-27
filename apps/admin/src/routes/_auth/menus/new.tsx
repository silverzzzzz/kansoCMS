import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../../api/client.ts'
import { unwrap } from '../../../api/request.ts'
import { markCreated } from '../../../components/editing/created-notice.ts'
import { MenuForm } from '../../../components/MenuForm.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'

export const Route = createFileRoute('/_auth/menus/new')({ component: NewMenuPage })

function NewMenuPage() {
  const navigate = useNavigate({ from: '/menus/new' })
  const queryClient = useQueryClient()
  return (
    <div>
      <PageHeading title="メニューを作成" />
      <MenuForm
        onSave={async (input) => {
          const { item } = await unwrap(api.menus.$post({ json: input }))
          await queryClient.invalidateQueries({ queryKey: ['menus'] })
          markCreated(queryClient, 'menus', item.id)
          return () =>
            navigate({ to: '/menus/$id', params: { id: String(item.id) }, replace: true })
        }}
      />
    </div>
  )
}
