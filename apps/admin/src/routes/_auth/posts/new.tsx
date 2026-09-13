import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { categoriesQuery, postTypesQuery, type TagItem, tagsQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ContentForm, emptyContent } from '../../../components/content/ContentForm.tsx'
import { MediaField } from '../../../components/media/MediaField.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { TagInput } from '../../../components/TagInput.tsx'
import { Alert } from '../../../components/ui.tsx'
import { fromDateTimeLocal } from '../../../lib/datetime.ts'
import { flattenPageTree } from '../../../lib/page-tree.ts'

type NewPostSearch = { type?: string }
export const Route = createFileRoute('/_auth/posts/new')({
  validateSearch: (search: Record<string, unknown>): NewPostSearch => ({
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
  component: NewPostPage,
})

function NewPostPage() {
  const typeSlug = Route.useSearch().type
  const navigate = useNavigate({ from: '/posts/new' })
  const queryClient = useQueryClient()
  const types = useQuery(postTypesQuery)
  const type = types.data?.items.find((item) => item.slug === typeSlug)
  const categories = useQuery({ ...categoriesQuery(type?.id ?? 0), enabled: Boolean(type) })
  const [content, setContent] = useState(emptyContent)
  const [coverMediaId, setCoverMediaId] = useState<number | null>(null)
  const [categoryIds, setCategoryIds] = useState<number[]>([])
  const [selectedTags, setSelectedTags] = useState<TagItem[]>([])
  const save = useMutation({
    mutationFn: () => {
      if (!type) throw new Error('投稿タイプがありません')
      return unwrap(
        api.posts.$post({
          json: {
            postTypeId: type.id,
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
            coverMediaId,
            categoryIds,
            tagIds: selectedTags.map((tag) => tag.id),
          },
        }),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['posts'] })
      await navigate({ to: '/posts', search: { type: typeSlug } })
    },
  })
  const errors = fieldErrors(save.error)
  if (!type) return <p>読み込み中…</p>
  const categoryRows = flattenPageTree(
    (categories.data?.items ?? []).map((item) => ({ ...item, title: item.name })),
  )
  return (
    <div>
      <PageHeading title={`${type.name}を作成`} />
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
        editorKey="new-post"
      >
        <section className="grid gap-6 border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <MediaField label="カバー画像" value={coverMediaId} onChange={setCoverMediaId} />
          {type.hasCategories && (
            <fieldset>
              <legend className="text-sm font-medium">カテゴリ</legend>
              <div className="mt-2 space-y-2">
                {categoryRows.map(({ page, depth }) => (
                  <label
                    key={page.id}
                    className="flex items-center gap-2 text-sm"
                    style={{ marginLeft: `${depth * 1.25}rem` }}
                  >
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(page.id)}
                      onChange={(event) =>
                        setCategoryIds(
                          event.target.checked
                            ? [...categoryIds, page.id]
                            : categoryIds.filter((id) => id !== page.id),
                        )
                      }
                    />
                    {page.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {type.hasTags && (
            <div className="sm:col-span-2">
              <TagInput value={selectedTags} onChange={setSelectedTags} />
            </div>
          )}
        </section>
      </ContentForm>
    </div>
  )
}
