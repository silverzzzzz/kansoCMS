import { createFileRoute } from '@tanstack/react-router'
import { pagesListQuery, sectionCatalogQuery } from '../../../api/queries.ts'
import { PageContentEditor } from '../../../components/content/PageContentEditor.tsx'

export const Route = createFileRoute('/_auth/pages/new')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(pagesListQuery({ perPage: '100' })),
      context.queryClient.ensureQueryData(sectionCatalogQuery),
    ]),
  component: () => <PageContentEditor />,
})
