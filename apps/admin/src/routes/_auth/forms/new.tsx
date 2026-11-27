import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../../api/client.ts'
import { formsListQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { markCreated } from '../../../components/editing/created-notice.ts'
import { FormEditor } from '../../../components/forms/FormEditor.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'

export const Route = createFileRoute('/_auth/forms/new')({
  loader: ({ context }) => context.queryClient.ensureQueryData(formsListQuery),
  component: NewFormPage,
})

function NewFormPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/forms/new' })
  const forms = useQuery(formsListQuery)
  return (
    <div>
      <PageHeading title="フォームを作成" />
      <FormEditor
        turnstileAvailable={forms.data?.turnstileAvailable ?? false}
        onSubmit={async (input) => {
          const { item } = await unwrap(api.forms.$post({ json: input }))
          await queryClient.invalidateQueries({ queryKey: ['forms'] })
          markCreated(queryClient, 'forms', item.id)
          return () =>
            navigate({ to: '/forms/$id', params: { id: String(item.id) }, replace: true })
        }}
      />
    </div>
  )
}
