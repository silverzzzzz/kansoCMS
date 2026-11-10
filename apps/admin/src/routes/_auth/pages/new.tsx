import type { PageSection } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { pagesListQuery, sectionCatalogQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ContentForm, emptyContent } from '../../../components/content/ContentForm.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Field, inputClass } from '../../../components/ui.tsx'
import { fromDateTimeLocal } from '../../../lib/datetime.ts'
import { flattenPageTree } from '../../../lib/page-tree.ts'

export const Route = createFileRoute('/_auth/pages/new')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(pagesListQuery({ perPage: '100' })),
      context.queryClient.ensureQueryData(sectionCatalogQuery),
    ]),
  component: NewPage,
})

function NewPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/pages/new' })
  const pages = useQuery(pagesListQuery({ perPage: '100' }))
  const catalog = useQuery(sectionCatalogQuery)
  const [content, setContent] = useState(emptyContent)
  const [parentId, setParentId] = useState<number | null>(null)
  const [sortOrder, setSortOrder] = useState(0)
  const [templateId, setTemplateId] = useState('richtext')
  const [sections, setSections] = useState<PageSection[] | null>(null)
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
            sections,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
      await navigate({ to: '/pages' })
    },
  })
  const errors = fieldErrors(save.error)
  const parent = pages.data?.items.find((page) => page.id === parentId)
  const templates = catalog.data?.templates ?? []
  const sectionLabel = (type: string) =>
    catalog.data?.items.find((item) => item.type === type)?.label ?? type
  const chooseTemplate = (id: string) => {
    setTemplateId(id)
    const template = templates.find((item) => item.id === id)
    setSections(
      template
        ? template.sections.map((section) => ({ ...section, id: crypto.randomUUID() }))
        : null,
    )
  }

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
        publicPath={parent ? `/${parent.path}/${content.slug}` : `/${content.slug}`}
      >
        <div className="grid gap-5 border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <Field label="テンプレート">
            <select
              className={inputClass}
              value={templateId}
              onChange={(event) => chooseTemplate(event.target.value)}
            >
              <option value="richtext">リッチテキスト（セクションなし）</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} — {template.description}
                </option>
              ))}
            </select>
          </Field>
          {sections && (
            <div className="sm:col-span-2">
              <p className="text-xs text-neutral-500">
                セクション構成: {sections.map((section) => sectionLabel(section.type)).join(' / ')}
                。作成後はカスタマイズ画面で内容を編集できます。
              </p>
            </div>
          )}
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
