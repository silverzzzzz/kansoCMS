import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { pageQuery, pageRevisionsQuery, pagesListQuery } from '../../../api/queries.ts'
import { PageContentEditor } from '../../../components/content/PageContentEditor.tsx'

export const Route = createFileRoute('/_auth/pages/$id')({
  remountDeps: ({ params }) => params.id,
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(pageQuery(Number(params.id))),
      context.queryClient.ensureQueryData(pageRevisionsQuery(Number(params.id))),
      context.queryClient.ensureQueryData(pagesListQuery({ perPage: '100' })),
    ]),
  component: EditPage,
})

function EditPage() {
  const id = Number(Route.useParams().id)
  const query = useQueryClient()
  const item = useSuspenseQuery(pageQuery(id)).data.item
  const [generation, setGeneration] = useState(0)
  const reload = async () => {
    await query.invalidateQueries({ queryKey: ['pages'] }, { throwOnError: true })
    setGeneration((old) => old + 1)
  }
  return <PageContentEditor key={generation} item={item} reload={reload} />
}
