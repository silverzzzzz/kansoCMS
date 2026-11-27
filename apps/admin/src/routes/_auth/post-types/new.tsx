import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../../api/client.ts'
import { unwrap } from '../../../api/request.ts'
import { markCreated } from '../../../components/editing/created-notice.ts'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { PostTypeForm } from '../../../components/PostTypeForm.tsx'

export const Route = createFileRoute('/_auth/post-types/new')({ component: NewPostTypePage })

function NewPostTypePage() {
  const navigate = useNavigate({ from: '/post-types/new' })
  const queryClient = useQueryClient()
  return (
    <div>
      <PageHeading title="投稿タイプを作成" />
      <PostTypeForm
        onSave={async (input) => {
          const { item } = await unwrap(
            api['post-types'].$post({
              json: { ...input, description: input.description.trim() || null },
            }),
          )
          await queryClient.invalidateQueries({ queryKey: ['post-types'] })
          markCreated(queryClient, 'post-types', item.id)
          return () =>
            navigate({ to: '/post-types/$id', params: { id: String(item.id) }, replace: true })
        }}
      />
    </div>
  )
}
