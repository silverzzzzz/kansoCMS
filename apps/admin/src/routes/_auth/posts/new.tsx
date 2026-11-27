import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { categoriesQuery, postTypesQuery, tagsQuery } from '../../../api/queries.ts'
import { PostContentEditor } from '../../../components/content/PostContentEditor.tsx'

export const Route = createFileRoute('/_auth/posts/new')({
  validateSearch: (search: Record<string, unknown>): { type?: string } => ({
    type: typeof search.type === 'string' ? search.type : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    if (!deps.type) throw redirect({ to: '/posts' })
    const types = await context.queryClient.ensureQueryData(postTypesQuery)
    const type = types.items.find((item) => item.slug === deps.type)
    if (!type) throw redirect({ to: '/posts' })
    await Promise.all([
      context.queryClient.ensureQueryData(categoriesQuery(type.id)),
      context.queryClient.ensureQueryData(tagsQuery()),
    ])
  },
  component: NewPost,
})

function NewPost() {
  const slug = Route.useSearch().type
  const type = useSuspenseQuery(postTypesQuery).data.items.find((item) => item.slug === slug)
  return type ? <PostContentEditor key={type.id} type={type} /> : null
}
