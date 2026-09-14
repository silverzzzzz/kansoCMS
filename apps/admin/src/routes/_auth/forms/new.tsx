import type { CreateFormInput } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../../api/client.ts'
import { formsListQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
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
  const save = useMutation({
    mutationFn: (input: CreateFormInput) => unwrap(api.forms.$post({ json: input })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['forms'] })
      await navigate({ to: '/forms' })
    },
  })

  return (
    <div>
      <PageHeading title="フォームを作成" />
      <FormEditor
        turnstileAvailable={forms.data?.turnstileAvailable ?? false}
        pending={save.isPending}
        error={save.error}
        onSubmit={(input) => save.mutate(input)}
      />
    </div>
  )
}
