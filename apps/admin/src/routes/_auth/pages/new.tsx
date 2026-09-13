import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { pagesListQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ContentForm, emptyContent } from '../../../components/content/ContentForm.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Field, inputClass } from '../../../components/ui.tsx'
import { fromDateTimeLocal } from '../../../lib/datetime.ts'
import { flattenPageTree } from '../../../lib/page-tree.ts'

export const Route = createFileRoute('/_auth/pages/new')({
  loader: ({ context }) => context.queryClient.ensureQueryData(pagesListQuery({ perPage: '100' })),
  component: NewPage,
})

function NewPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/pages/new' })
  const pages = useQuery(pagesListQuery({ perPage: '100' }))
  const [content, setContent] = useState(emptyContent)
  const [parentId, setParentId] = useState<number | null>(null)
  const [sortOrder, setSortOrder] = useState(0)
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.pages.$post({
          json: {
            title: content.title,
            slug: content.slug,
            status: content.status,
            publishedAt: fromDateTimeLocal(content.publishedAt),
            bodyJson: content.bodyJson,
            excerpt: content.excerpt.trim() || null,
            seoTitle: content.seoTitle.trim() || null,
            seoDescription: content.seoDescription.trim() || null,
            ogMediaId: content.ogMediaId,
            noindex: content.noindex,
            canonicalUrl: content.canonicalUrl.trim() || null,
            parentId,
            sortOrder,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
      await navigate({ to: '/pages' })
    },
  })
  const errors = fieldErrors(save.error)

  return (
    <div>
      <PageHeading title="固定ページを作成" />
      {save.error && Object.keys(errors).length === 0 && (
        <div className="mt-6">
          <Alert tone="error">
            {save.error instanceof ApiError ? save.error.message : '保存できませんでした'}
          </Alert>
        </div>
      )}
      <ContentForm
        value={content}
        onChange={setContent}
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
        pending={save.isPending}
        errors={errors}
        autoSlug
        editorKey="new-page"
      >
        <div className="grid gap-5 border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <Field label="親ページ" error={errors.parentId}>
            <select
              className={inputClass}
              value={parentId ?? ''}
              onChange={(event) =>
                setParentId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">なし</option>
              {flattenPageTree(pages.data?.items ?? []).map(({ page, depth }) => (
                <option key={page.id} value={page.id}>
                  {'—'.repeat(depth)} {page.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="表示順" error={errors.sortOrder}>
            <input
              className={inputClass}
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(Number(event.target.value))}
            />
          </Field>
        </div>
      </ContentForm>
    </div>
  )
}
