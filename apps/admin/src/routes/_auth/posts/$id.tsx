import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  categoriesQuery,
  postQuery,
  postRevisionsQuery,
  postTypesQuery,
  tagsQuery,
} from '../../../api/queries.ts'
import { PostContentEditor } from '../../../components/content/PostContentEditor.tsx'

export const Route = createFileRoute('/_auth/posts/$id')({
  remountDeps: ({ params }) => params.id,
  loader: async ({ context, params }) => {
    const id = Number(params.id)
    const post = await context.queryClient.ensureQueryData(postQuery(id))
    await Promise.all([
      context.queryClient.ensureQueryData(postRevisionsQuery(id)),
      context.queryClient.ensureQueryData(postTypesQuery),
      context.queryClient.ensureQueryData(categoriesQuery(post.item.postTypeId)),
      context.queryClient.ensureQueryData(tagsQuery()),
    ])
  },
  component: EditPost,
})

function EditPost() {
  const id = Number(Route.useParams().id)
  const query = useQueryClient()
  const item = useSuspenseQuery(postQuery(id)).data.item
  const type = useSuspenseQuery(postTypesQuery).data.items.find(
    (type) => type.id === item.postTypeId,
  )
  const [generation, setGeneration] = useState(0)
  const reload = async () => {
    await query.invalidateQueries({ queryKey: ['posts'] }, { throwOnError: true })
    setGeneration((old) => old + 1)
  }
  return type ? (
    <PostContentEditor key={generation} type={type} item={item} reload={reload} />
  ) : null
}
